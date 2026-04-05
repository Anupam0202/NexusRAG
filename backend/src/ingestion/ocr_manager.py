"""
Cloud OCR Manager  (Gemini Vision + Cloud Vision)
===================================================

Process-wide singleton for cloud-based OCR, replacing PaddleOCR.

Backends:
  1. **Gemini Vision** (primary)  — understanding-based, handles layout,
     handwriting, multilingual, stamps, seals.
  2. **Google Cloud Vision** (fallback) — pixel-perfect traditional OCR.

Environment variables:
    GOOGLE_API_KEY             — powers both Gemini and Cloud Vision REST API
    GOOGLE_APPLICATION_CREDENTIALS — (optional) GCP service-account JSON
"""

from __future__ import annotations

import base64
import io
import json
import os
import re
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from PIL import Image, ImageEnhance

from src.utils.logger import get_logger

logger = get_logger(__name__)


# ═══════════════════════════════════════════════════════════════════════════
#  GEMINI VISION OCR  (Primary Backend)
# ═══════════════════════════════════════════════════════════════════════════

class GeminiVisionOCR:
    """Primary extraction backend using Google Gemini multimodal LLM.

    Unlike traditional OCR, Gemini UNDERSTANDS document layout, context,
    handwriting, multilingual text, stamps, and seals.
    """

    UNIVERSAL_PROMPT = (
        "You are a pure OCR engine. Output ONLY the raw text visible in this image.\n"
        "\n"
        "Rules:\n"
        "- Reproduce every word, number, and symbol exactly as shown\n"
        "- Reading order: top to bottom, left to right\n"
        "- For tables: use | column | separators |\n"
        "- For forms or ID cards: use Label: Value on each line\n"
        "- Include all languages present in the image\n"
        "- Note non-text elements briefly inline: [Photo], [Signature], [Seal], [QR Code]\n"
        "- NEVER repeat or duplicate any line of output\n"
        "- Each piece of information should appear EXACTLY ONCE\n"
        "\n"
        "FORBIDDEN — do NOT output any of these:\n"
        "- Descriptions of the document (e.g. 'This is a PAN card')\n"
        "- Markdown formatting (no **, no ##, no bullet points)\n"
        "- Preamble (no 'Here is the extracted text')\n"
        "- Explanations, commentary, or notes of any kind\n"
        "- Fields marked N/A if they don't exist on the document\n"
        "- Duplicate lines — each line of text must appear only once\n"
        "\n"
        "Begin output immediately with the first piece of text visible."
    )

    _RULES_SUFFIX = (
        "\n\nFORBIDDEN:\n"
        "- Do NOT describe what type of document this is\n"
        "- Do NOT use markdown formatting (no **, no ##, no bullets)\n"
        "- Do NOT add commentary, explanations, or 'N/A' fields\n"
        "- Do NOT say 'Here is the text' — just output the text directly\n"
        "- Do NOT repeat or duplicate any line — each item EXACTLY ONCE"
    )

    TYPED_PROMPTS: Dict[str, str] = {
        "id_card": (
            "OCR this ID card / government document. "
            "Output every field as 'Label: Value', one per line. "
            "Include the card header, name, parent's name, ID number, "
            "date of birth, and any other text. "
            "Note [Photo], [Signature], [Seal], [QR Code] inline. "
            "CRITICAL: Each field must appear EXACTLY ONCE — no duplicates."
        ),
        "certificate": (
            "OCR this certificate / degree. "
            "Output all text in reading order: institution, title, "
            "recipient, registration numbers, date, grades, and all "
            "other visible text. Note [Signature], [Seal] inline. "
            "CRITICAL: Each piece of text must appear EXACTLY ONCE."
        ),
        "invoice": (
            "OCR this invoice / receipt. "
            "Output company details, invoice number, date, "
            "all line items with quantities and prices, "
            "totals, taxes, payment terms. Use | separators | for tables. "
            "CRITICAL: Each line item must appear EXACTLY ONCE."
        ),
        "scientific": (
            "Extract ALL text from this scientific paper page. "
            "Include: title, authors, abstract, section headings, "
            "body text, equations (as LaTeX), table contents (use | separators |), "
            "figure captions, references, and footnotes. "
            "Reading order: top to bottom, left to right, column-aware. "
            "CRITICAL: Each piece of text must appear EXACTLY ONCE."
        ),
    }

    TABLE_PROMPT = (
        "Extract the table in this image. "
        "Output a clean pipe-delimited table:\n"
        "| Column1 | Column2 | Column3 |\n"
        "| value1  | value2  | value3  |\n"
        "Include headers and ALL data rows exactly as shown. "
        "Do NOT add commentary — only output the table."
    )

    FIGURE_PROMPT = (
        "Describe this image/figure from a scientific document. "
        "If there is text in the image, extract it verbatim. "
        "If it's a chart or graph, describe: type, axes, key data points, "
        "and any labels/legends. Be concise but thorough."
    )

    def __init__(self) -> None:
        self._model = None
        self._available = False
        self._api_key = os.environ.get("GOOGLE_API_KEY", "")
        self._disabled_at: Optional[float] = None
        self._cooldown_seconds: float = 300.0  # 5 minutes
        if self._api_key:
            self._init_model()

    def _init_model(self) -> None:
        try:
            import google.generativeai as genai
            genai.configure(api_key=self._api_key)

            for name in [
                "gemini-2.0-flash",
                "gemini-1.5-flash", "gemini-1.5-pro",
                "gemini-pro-vision",
            ]:
                try:
                    self._model = genai.GenerativeModel(name)
                    self._available = True
                    logger.info("gemini_vision_ready", model=name)
                    return
                except Exception:
                    continue
            logger.warning("gemini_no_model_available")
        except ImportError:
            logger.info("google_generativeai_not_installed")
        except Exception as exc:
            logger.warning("gemini_init_failed", error=str(exc))

    @property
    def available(self) -> bool:
        return self._available

    # ── Output cleaner with deduplication ────────────────────────

    @staticmethod
    def _clean(text: str) -> str:
        """Strip markdown, commentary, and duplicate lines."""
        if not text:
            return text

        skip = [
            re.compile(
                r"^(here\s+(is|are)\s+the|the\s+extracted|below\s+is|"
                r"this\s+(document|image|is\s+a)|i\s+can\s+see|"
                r"the\s+following\s+text|output:)", re.I
            ),
            re.compile(r"^```"),
            re.compile(r"^\*\*\s*(note|n/?a)\s*", re.I),
        ]

        lines = text.splitlines()
        cleaned: list[str] = []

        for line in lines:
            s = line.strip()
            if not cleaned and not s:
                continue
            if any(p.search(s) for p in skip):
                continue
            # Strip markdown bold/italic
            s = re.sub(r"\*\*(.+?)\*\*", r"\1", s)
            s = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"\1", s)
            s = re.sub(r"^[\*\-•]\s+", "", s)
            if re.match(r"^.{0,30}:\s*n/?a\b", s, re.I):
                continue
            cleaned.append(s)

        while cleaned and not cleaned[-1].strip():
            cleaned.pop()

        # Deduplicate
        seen: set[str] = set()
        deduped: list[str] = []
        for line in cleaned:
            key = re.sub(r"\s+", " ", line.strip().lower())
            if not key:
                if deduped and deduped[-1].strip() == "":
                    continue
                deduped.append(line)
                continue
            if key in seen:
                continue
            seen.add(key)
            deduped.append(line)

        return "\n".join(deduped)

    # ── Core extraction ──────────────────────────────────────────

    def _send(self, image: np.ndarray, prompt: str) -> Tuple[str, float]:
        """Send image + prompt to Gemini, return (cleaned_text, confidence)."""
        # Auto-recover from temporary quota exhaustion after cooldown
        if not self._available and self._disabled_at is not None:
            import time as _time
            elapsed = _time.time() - self._disabled_at
            if elapsed > self._cooldown_seconds:
                self._available = True
                self._disabled_at = None
                logger.info("gemini_ocr_recovered", cooldown_s=round(elapsed, 1))

        if not self._available or self._model is None:
            return "", 0.0
        try:
            pil = Image.fromarray(image)
            w, h = pil.size
            if max(w, h) > 4096:
                scale = 4096 / max(w, h)
                pil = pil.resize(
                    (int(w * scale), int(h * scale)), Image.LANCZOS
                )

            resp = self._model.generate_content(
                [prompt, pil],
                generation_config={
                    "temperature": 0.1,
                    "max_output_tokens": 4096,
                },
                request_options={"timeout": 30},
            )

            raw = ""
            # Handle both string and parts-based responses
            try:
                raw = resp.text.strip()
            except Exception:
                if hasattr(resp, "candidates") and resp.candidates:
                    parts = resp.candidates[0].content.parts
                    raw = "".join(
                        p.text for p in parts if hasattr(p, "text")
                    ).strip()

            text = self._clean(raw)
            return (text, 0.95) if text else ("", 0.0)
        except Exception as exc:
            err_msg = str(exc).lower()
            # If quota exhausted, disable OCR for the rest of this session
            # to avoid cascading 429 retries on every subsequent page
            if any(kw in err_msg for kw in ("429", "quota", "resource_exhausted", "resource exhausted")):
                logger.warning("gemini_ocr_quota_exhausted — disabling for cooldown")
                self._available = False
                import time as _time
                self._disabled_at = _time.time()
            else:
                logger.warning("gemini_ocr_error", error=str(exc))
            return "", 0.0

    def extract_text(self, image: np.ndarray) -> Tuple[str, float]:
        """Universal extraction — works for ANY document type."""
        text, conf = self._send(image, self.UNIVERSAL_PROMPT)
        if text:
            logger.debug("gemini_extracted", chars=len(text))
        return text, conf

    def extract_typed(
        self, image: np.ndarray, doc_type: str
    ) -> Tuple[str, float]:
        """Type-specific extraction for improved structure."""
        base = self.TYPED_PROMPTS.get(doc_type)
        if not base:
            return self.extract_text(image)
        prompt = base + self._RULES_SUFFIX
        text, conf = self._send(image, prompt)
        if text:
            logger.debug("gemini_typed_extracted", doc_type=doc_type, chars=len(text))
        return text, conf

    def extract_table(self, image: np.ndarray) -> Tuple[str, float]:
        """Table-specific extraction."""
        return self._send(image, self.TABLE_PROMPT)

    def extract_figure(self, image: np.ndarray) -> Tuple[str, float]:
        """Figure description extraction."""
        return self._send(image, self.FIGURE_PROMPT)


# ═══════════════════════════════════════════════════════════════════════════
#  GOOGLE CLOUD VISION OCR  (Fallback Backend)
# ═══════════════════════════════════════════════════════════════════════════

class CloudVisionOCR:
    """Fallback extraction using Google Cloud Vision API.

    Supports two modes:
      1. google-cloud-vision library (if installed + credentials)
      2. REST API with GOOGLE_API_KEY (zero extra packages)
    """

    def __init__(self) -> None:
        self._available = False
        self._verified = False
        self._method: Optional[str] = None
        self._client: Any = None
        self._api_key = ""

        self._try_library()
        if not self._available:
            self._try_rest()

    def _try_library(self) -> None:
        creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
        if not creds:
            return
        try:
            from google.cloud import vision  # type: ignore
            self._client = vision.ImageAnnotatorClient()
            self._method = "library"
            self._available = True
            self._verified = True
            logger.info("cloud_vision_ready", method="library")
        except ImportError:
            pass
        except Exception as exc:
            logger.debug("cloud_vision_library_failed", error=str(exc))

    def _try_rest(self) -> None:
        self._api_key = os.environ.get(
            "GOOGLE_CLOUD_API_KEY",
            os.environ.get("GOOGLE_API_KEY", ""),
        )
        if self._api_key:
            self._method = "rest"
            self._available = True
            logger.info("cloud_vision_ready", method="rest")

    @property
    def available(self) -> bool:
        return self._available

    @staticmethod
    def _to_png_bytes(image: np.ndarray) -> bytes:
        pil = Image.fromarray(image)
        buf = io.BytesIO()
        pil.save(buf, format="PNG", optimize=True)
        return buf.getvalue()

    def _extract_library(self, image_bytes: bytes) -> Tuple[str, float]:
        from google.cloud import vision  # type: ignore

        image = vision.Image(content=image_bytes)
        resp = self._client.document_text_detection(
            image=image,
            image_context=vision.ImageContext(language_hints=["en", "hi"]),
        )
        if resp.error.message:
            raise RuntimeError(resp.error.message)

        annotation = resp.full_text_annotation
        text = annotation.text if annotation else ""
        confs: list[float] = []
        if annotation:
            for page in annotation.pages:
                for block in page.blocks:
                    for para in block.paragraphs:
                        for word in para.words:
                            conf = getattr(word, "confidence", None)
                            if conf is not None:
                                confs.append(float(conf))
        avg = sum(confs) / len(confs) if confs else 0.85
        return text.strip(), avg

    def _extract_rest(self, image_bytes: bytes) -> Tuple[str, float]:
        url = (
            "https://vision.googleapis.com/v1/images:annotate"
            f"?key={self._api_key}"
        )
        payload = json.dumps({
            "requests": [{
                "image": {
                    "content": base64.b64encode(image_bytes).decode(),
                },
                "features": [{"type": "DOCUMENT_TEXT_DETECTION"}],
                "imageContext": {"languageHints": ["en", "hi"]},
            }]
        }).encode("utf-8")

        req = urllib.request.Request(
            url, data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read())

        if "error" in result:
            raise RuntimeError(
                result["error"].get("message", "Unknown error")
            )
        response = result.get("responses", [{}])[0]
        if "error" in response:
            raise RuntimeError(
                response["error"].get("message", "Unknown error")
            )

        annotation = response.get("fullTextAnnotation", {})
        text = annotation.get("text", "")
        confs: list[float] = []
        for page in annotation.get("pages", []):
            for block in page.get("blocks", []):
                for para in block.get("paragraphs", []):
                    for word in para.get("words", []):
                        c = word.get("confidence")
                        if c is not None:
                            confs.append(c)
        avg = sum(confs) / len(confs) if confs else 0.85
        return text.strip(), avg

    def extract_text(self, image: np.ndarray) -> Tuple[str, float]:
        """Extract text using Cloud Vision API."""
        if not self._available:
            return "", 0.0

        image_bytes = self._to_png_bytes(image)
        try:
            if self._method == "library":
                text, conf = self._extract_library(image_bytes)
            else:
                text, conf = self._extract_rest(image_bytes)

            if not self._verified:
                self._verified = True
                logger.info("cloud_vision_verified")

            if text:
                logger.debug("cloud_vision_extracted", chars=len(text), conf=f"{conf:.2f}")
            return text, conf

        except Exception as exc:
            err = str(exc)
            if not self._verified:
                self._verified = True
                self._available = False
                if "PERMISSION_DENIED" in err or "403" in err:
                    logger.warning(
                        "cloud_vision_not_enabled",
                        hint="Enable at console.cloud.google.com/apis/library/vision.googleapis.com",
                    )
                else:
                    logger.warning("cloud_vision_api_error", error=err)
            else:
                logger.warning("cloud_vision_error", error=err)
            return "", 0.0


# ═══════════════════════════════════════════════════════════════════════════
#  IMAGE PREPROCESSING  (for Cloud Vision fallback)
# ═══════════════════════════════════════════════════════════════════════════

class Preprocessor:
    """Multiple preprocessing strategies.
    The extractor tries each and keeps whichever produces the most text.
    Primarily benefits Cloud Vision (pixel-based OCR).
    Gemini usually works fine on raw images.
    """

    @staticmethod
    def upscale(image: np.ndarray, target: int = 3000) -> np.ndarray:
        import cv2
        h, w = image.shape[:2]
        if max(h, w) >= target:
            return image
        s = target / max(h, w)
        return cv2.resize(image, None, fx=s, fy=s, interpolation=cv2.INTER_CUBIC)

    @staticmethod
    def standard(image: np.ndarray) -> np.ndarray:
        import cv2
        img = Preprocessor.upscale(image, 3000)
        img = cv2.bilateralFilter(img, 9, 75, 75)
        lab = cv2.cvtColor(img, cv2.COLOR_RGB2LAB)
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        lab[:, :, 0] = clahe.apply(lab[:, :, 0])
        img = cv2.cvtColor(lab, cv2.COLOR_LAB2RGB)
        k = np.array([[0, -0.5, 0], [-0.5, 3, -0.5], [0, -0.5, 0]])
        img = cv2.filter2D(img, -1, k)
        return np.clip(img, 0, 255).astype(np.uint8)

    @staticmethod
    def high_contrast(image: np.ndarray) -> np.ndarray:
        img = Preprocessor.upscale(image, 3500)
        pil = Image.fromarray(img)
        pil = ImageEnhance.Contrast(pil).enhance(2.5)
        pil = ImageEnhance.Sharpness(pil).enhance(2.0)
        pil = ImageEnhance.Brightness(pil).enhance(1.15)
        return np.array(pil)

    @staticmethod
    def grayscale_otsu(image: np.ndarray) -> np.ndarray:
        import cv2
        img = Preprocessor.upscale(image, 3000)
        gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
        gray = cv2.GaussianBlur(gray, (3, 3), 0)
        _, binary = cv2.threshold(
            gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
        )
        kernel = np.ones((2, 2), np.uint8)
        binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
        return cv2.cvtColor(binary, cv2.COLOR_GRAY2RGB)

    ALL: list[tuple[str, Any]] = [
        ("standard", lambda img: Preprocessor.standard(img)),
        ("high_contrast", lambda img: Preprocessor.high_contrast(img)),
        ("otsu_binary", lambda img: Preprocessor.grayscale_otsu(img)),
        ("raw_upscale", lambda img: Preprocessor.upscale(img, 3500)),
    ]


# ═══════════════════════════════════════════════════════════════════════════
#  CONTENT-BASED DOCUMENT TYPE DETECTION
# ═══════════════════════════════════════════════════════════════════════════

def detect_type_from_text(text: str) -> str:
    """Detect document type from extracted text content."""
    t = text.lower()

    id_patterns = [
        r"permanent\s*account\s*number", r"pan\s*(card|number)",
        r"aadhaar", r"voter\s*id", r"driving\s*licen[cs]e",
        r"passport\s*no", r"income\s*tax\s*department",
        r"unique\s*identification", r"election\s*commission",
        r"(father|mother|husband).*name",
        r"date\s*of\s*birth.*\d{2}[/\-]\d{2}[/\-]\d{4}",
    ]
    if sum(1 for p in id_patterns if re.search(p, t)) >= 2:
        return "id_card"

    cert_patterns = [
        r"(this\s+is\s+to\s+)?certif(y|icate)",
        r"degree\s*(of|in)",
        r"(awarded|conferred)\s*(to|upon)",
        r"(university|institute|college).*hereby",
        r"(bachelor|master|doctor|diploma)\s*(of|in)",
        r"(cgpa|dgpa|sgpa|percentage|grade\s*point)",
        r"convocation", r"registrar",
    ]
    if sum(1 for p in cert_patterns if re.search(p, t)) >= 2:
        return "certificate"

    inv_patterns = [
        r"invoice\s*(no|number|#|date)",
        r"(bill|receipt)\s*(no|to|date)",
        r"(sub\s*)?total",
        r"(tax|gst|vat|cgst|sgst|igst)",
        r"(qty|quantity)\s*.*\s*(price|rate|amount)",
        r"payment\s*(due|terms|method)",
    ]
    if sum(1 for p in inv_patterns if re.search(p, t)) >= 2:
        return "invoice"

    sci_patterns = [
        r"abstract", r"introduction", r"methodology|methods",
        r"results?\s*(and|&)\s*discussion",
        r"conclusion", r"references\s*$",
        r"et\s+al\.", r"\[\d+\]",
        r"equation\s*\(?\d", r"fig(ure)?\s*\d",
    ]
    if sum(1 for p in sci_patterns if re.search(p, t)) >= 3:
        return "scientific"

    return "document"


def _unique_line_count(text: str) -> int:
    """Count unique non-empty lines (normalized)."""
    seen: set[str] = set()
    count: int = 0
    for line in text.strip().splitlines():
        key: str = re.sub(r"\s+", " ", line.strip().lower())
        if key and key not in seen:
            seen.add(key)
            count += 1
    return count


# ═══════════════════════════════════════════════════════════════════════════
#  SINGLETON INSTANCES (process-wide)
# ═══════════════════════════════════════════════════════════════════════════

_gemini_instance: Optional[GeminiVisionOCR] = None
_cloud_instance: Optional[CloudVisionOCR] = None


def get_gemini_ocr() -> Optional[GeminiVisionOCR]:
    """Return a singleton GeminiVisionOCR (or None if unavailable)."""
    global _gemini_instance
    if _gemini_instance is not None:
        return _gemini_instance if _gemini_instance.available else None
    _gemini_instance = GeminiVisionOCR()
    return _gemini_instance if _gemini_instance.available else None


def get_cloud_vision() -> Optional[CloudVisionOCR]:
    """Return a singleton CloudVisionOCR (or None if unavailable)."""
    global _cloud_instance
    if _cloud_instance is not None:
        return _cloud_instance if _cloud_instance.available else None
    _cloud_instance = CloudVisionOCR()
    return _cloud_instance if _cloud_instance.available else None


def ocr_image(image: np.ndarray) -> Tuple[str, float]:
    """One-shot OCR: try Gemini first, then Cloud Vision with preprocessing.

    Returns (text, confidence).
    """
    MIN_CHARS = 20
    SPARSE_CHARS = 50
    best_text: str = ""
    best_conf: float = 0.0

    # Strategy 1: Gemini
    gemini = get_gemini_ocr()
    if gemini:
        text, conf = gemini.extract_text(image)
        if text.strip():
            best_text, best_conf = text, conf
            if len(text.strip()) >= SPARSE_CHARS:
                return best_text, best_conf

        # Strategy 2: type-specific Gemini prompt
        if len(best_text.strip()) >= MIN_CHARS:
            doc_type = detect_type_from_text(best_text)
            if doc_type != "document":
                typed_text, typed_conf = gemini.extract_typed(image, doc_type)
                if _unique_line_count(typed_text) >= _unique_line_count(best_text) * 0.8:
                    best_text, best_conf = typed_text, typed_conf

        if len(best_text.strip()) >= SPARSE_CHARS:
            return best_text, best_conf

    # Strategy 3: Cloud Vision
    cloud = get_cloud_vision()
    if cloud:
        text, conf = cloud.extract_text(image)
        if len(text.strip()) > len(best_text.strip()):
            best_text, best_conf = text, conf

        # Strategy 4: Cloud Vision + preprocessing
        if len(best_text.strip()) < SPARSE_CHARS:
            for name, fn in Preprocessor.ALL:
                if len(best_text.strip()) >= SPARSE_CHARS:
                    break
                try:
                    processed = fn(image)
                    text, conf = cloud.extract_text(processed)
                    if len(text.strip()) > len(best_text.strip()):
                        best_text, best_conf = text, conf
                        logger.debug("cloud_vision_preprocess_win", strategy=name)
                except Exception:
                    pass

    return best_text, best_conf


# Flag for backward compatibility
OCR_AVAILABLE = bool(os.environ.get("GOOGLE_API_KEY"))
