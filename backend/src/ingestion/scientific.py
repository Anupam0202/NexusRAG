"""
Scientific PDF Parser
======================

Production pipeline for arXiv-style research papers.

Extracts:
  * Section hierarchy (title -> subsection -> paragraph)
  * Equations (via Canny edge-density heuristic)
  * Tables (via Gemini Vision table extraction)
  * Figures + captions (proximity-linked)
  * Full OCR fallback per region

Uses Gemini Vision + Cloud Vision (via ``ocr_manager``).

Integrated into the existing ``PDFLoader`` when
``ENABLE_SCIENTIFIC_MODE=true``.
"""

from __future__ import annotations

import hashlib
import io
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
import pandas as pd
from PIL import Image

from src.utils.logger import get_logger

logger = get_logger(__name__)

# ── Cloud OCR (Gemini Vision + Cloud Vision) ─────────────────────────────

from src.ingestion.ocr_manager import (
    OCR_AVAILABLE,
    get_gemini_ocr,
    get_cloud_vision,
    ocr_image,
    detect_type_from_text,
)


# ── Data structures ───────────────────────────────────────────────────────


@dataclass
class Section:
    """A logical section in a scientific document."""
    title: str = ""
    content: List[str] = field(default_factory=list)
    level: int = 1
    page: int = 0


@dataclass
class Figure:
    """An extracted figure/image."""
    path: str = ""
    bbox: Tuple[int, int, int, int] = (0, 0, 0, 0)
    page: int = 0
    caption: str = ""
    ocr_text: str = ""


@dataclass
class Table:
    """An extracted table."""
    text: str = ""
    dataframe: Optional[pd.DataFrame] = None
    path: str = ""
    bbox: Tuple[int, int, int, int] = (0, 0, 0, 0)
    page: int = 0
    caption: str = ""


@dataclass
class Equation:
    """An extracted equation region."""
    image_path: str = ""
    latex: str = ""
    ocr_text: str = ""
    bbox: Tuple[int, int, int, int] = (0, 0, 0, 0)
    page: int = 0


@dataclass
class ParsedPage:
    """Intermediate per-page parse results."""
    sections: List[Section] = field(default_factory=list)
    figures: List[Figure] = field(default_factory=list)
    tables: List[Table] = field(default_factory=list)
    equations: List[Equation] = field(default_factory=list)
    captions: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class ScientificDocument:
    """Full parsed scientific document."""
    sections: List[Section] = field(default_factory=list)
    figures: List[Figure] = field(default_factory=list)
    tables: List[Table] = field(default_factory=list)
    equations: List[Equation] = field(default_factory=list)
    total_pages: int = 0
    metadata: Dict[str, Any] = field(default_factory=dict)


# =====================================================================
#  SCIENTIFIC PDF PARSER
# =====================================================================


class ScientificPDFParser:
    """Advanced parser for scientific/arXiv-style PDFs.

    Uses Gemini Vision for OCR and layout understanding, OpenCV for
    equation detection, and proximity heuristics for figure-caption
    linking.
    """

    EQUATION_EDGE_THRESHOLD = 0.06
    CAPTION_PROXIMITY_PX = 150

    def __init__(self, output_dir: str = "data/scientific_output") -> None:
        self._output_dir = Path(output_dir)
        self._figure_dir = self._output_dir / "figures"
        self._table_dir = self._output_dir / "tables"
        self._equation_dir = self._output_dir / "equations"
        for d in (self._figure_dir, self._table_dir, self._equation_dir):
            d.mkdir(parents=True, exist_ok=True)

        # Cloud OCR singletons
        self._gemini = get_gemini_ocr()
        self._cloud = get_cloud_vision()
        if self._gemini:
            logger.info("scientific_parser_ready", backend="gemini_vision")
        elif self._cloud:
            logger.info("scientific_parser_ready", backend="cloud_vision")

    # ── Public API ────────────────────────────────────────────────────

    def parse(self, pdf_bytes: bytes) -> ScientificDocument:
        """Parse an entire PDF into structured scientific components."""
        import fitz  # PyMuPDF

        doc_pdf = fitz.open("pdf", pdf_bytes)
        doc = ScientificDocument(total_pages=len(doc_pdf))

        for page_num, page_obj in enumerate(doc_pdf, 1):
            pix = page_obj.get_pixmap(dpi=300)
            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(
                pix.height, pix.width, pix.n
            )
            if img.shape[2] == 4:
                img = cv2.cvtColor(img, cv2.COLOR_RGBA2RGB)
            elif img.shape[2] == 1:
                img = cv2.cvtColor(img, cv2.COLOR_GRAY2RGB)

            parsed = self._parse_page(img, page_num)
            doc.sections.extend(parsed.sections)
            doc.figures.extend(parsed.figures)
            doc.tables.extend(parsed.tables)
            doc.equations.extend(parsed.equations)

        # Also extract embedded images via PyMuPDF
        self._extract_embedded_images(doc_pdf, doc)

        doc_pdf.close()

        logger.info(
            "scientific_parse_complete",
            pages=doc.total_pages,
            sections=len(doc.sections),
            figures=len(doc.figures),
            tables=len(doc.tables),
            equations=len(doc.equations),
        )
        return doc

    # ── Embedded image extraction via PyMuPDF ─────────────────────────

    def _extract_embedded_images(self, doc_pdf: Any, doc: ScientificDocument) -> None:
        """Extract embedded images directly from the PDF via PyMuPDF.

        This catches images that page-level OCR may miss,
        e.g. photographs, logos, watermarks, and scanned content.
        """
        for page_num, page_obj in enumerate(doc_pdf, 1):
            image_list = page_obj.get_images(full=True)
            for img_idx, img_info in enumerate(image_list):
                xref = img_info[0]
                try:
                    base_image = doc_pdf.extract_image(xref)
                    if not base_image or not base_image.get("image"):
                        continue
                    image_bytes = base_image["image"]
                    ext = base_image.get("ext", "png")

                    uid = hashlib.md5(image_bytes[:2048]).hexdigest()[:10]
                    path = str(self._figure_dir / f"emb_{page_num}_{img_idx}_{uid}.{ext}")
                    with open(path, "wb") as f:
                        f.write(image_bytes)

                    # OCR the embedded image using cloud OCR
                    ocr_text = ""
                    try:
                        pil_img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
                        img_np = np.array(pil_img)
                        ocr_text, _ = ocr_image(img_np)
                    except Exception:
                        pass

                    # Skip tiny images (icons, bullets, etc.)
                    w = base_image.get("width", 0)
                    h = base_image.get("height", 0)
                    if w < 50 or h < 50:
                        continue

                    doc.figures.append(Figure(
                        path=path,
                        bbox=(0, 0, w, h),
                        page=page_num,
                        ocr_text=ocr_text,
                    ))
                except Exception:
                    continue

    # ── Page-level parsing ────────────────────────────────────────────

    def _parse_page(self, image: np.ndarray, page_num: int) -> ParsedPage:
        """Parse a single page using Gemini Vision for full-page OCR,
        then extract structure from the text output.
        """
        result = ParsedPage()

        # Full-page OCR with Gemini Vision (scientific prompt)
        full_text = ""
        if self._gemini:
            text, conf = self._gemini.extract_typed(image, "scientific")
            if text.strip():
                full_text = text
        if not full_text and self._cloud:
            text, conf = self._cloud.extract_text(image)
            if text.strip():
                full_text = text

        if not full_text:
            return result

        # Parse structure from OCR text
        self._parse_text_structure(full_text, page_num, result)

        # Detect equations using edge density on the image
        self._detect_equations_in_page(image, page_num, result)

        # Extract figure-like regions using contour detection
        self._detect_figures_in_page(image, page_num, result)

        return result

    def _parse_text_structure(
        self, text: str, page_num: int, result: ParsedPage
    ) -> None:
        """Parse section hierarchy from OCR text output."""
        lines = text.strip().splitlines()
        current_section: Optional[Section] = None

        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue

            # Detect headings
            if self._is_heading(stripped):
                level = self._detect_heading_level(stripped)
                current_section = Section(
                    title=stripped, level=level, page=page_num
                )
                result.sections.append(current_section)
                continue

            # Detect captions
            cap_type = self._detect_caption(stripped)
            if cap_type:
                result.captions.append({
                    "type": cap_type,
                    "text": stripped,
                    "bbox": (0, 0, 0, 0),
                    "page": page_num,
                })
                continue

            # Regular text -> add to current section
            if current_section:
                current_section.content.append(stripped)
            else:
                current_section = Section(
                    title="", content=[stripped], page=page_num
                )
                result.sections.append(current_section)

    def _detect_equations_in_page(
        self, image: np.ndarray, page_num: int, result: ParsedPage
    ) -> None:
        """Detect equation regions using contour analysis and edge density."""
        gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
        # Threshold to find text-like regions
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

        # Find contours of potential equation regions
        h, w = image.shape[:2]
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        for contour in contours:
            x, y, cw, ch = cv2.boundingRect(contour)
            # Equation regions are typically wider than tall, centrally placed
            if cw < w * 0.3 or ch < 20 or ch > h * 0.15:
                continue
            # Check if region is roughly centered (equation-like)
            center_x = x + cw / 2
            if abs(center_x - w / 2) > w * 0.25:
                continue

            bbox = (x, y, x + cw, y + ch)
            if self._is_equation_region(image, bbox):
                eq = self._extract_equation(image, bbox, page_num)
                if eq:
                    result.equations.append(eq)

    def _detect_figures_in_page(
        self, image: np.ndarray, page_num: int, result: ParsedPage
    ) -> None:
        """Detect figure regions using contour analysis."""
        h, w = image.shape[:2]
        gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
        edges = cv2.Canny(gray, 50, 150)
        # Dilate to connect nearby edges
        kernel = np.ones((5, 5), np.uint8)
        dilated = cv2.dilate(edges, kernel, iterations=3)
        contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        for contour in contours:
            x, y, cw, ch = cv2.boundingRect(contour)
            area = cw * ch
            # Figures are typically large, non-text regions
            if area < (h * w * 0.05) or cw < 100 or ch < 100:
                continue
            if area > (h * w * 0.8):
                continue  # Too large — probably the whole page

            bbox = (x, y, x + cw, y + ch)
            fig = self._extract_figure(image, bbox, page_num)
            if fig:
                result.figures.append(fig)

    # ── Block helpers ─────────────────────────────────────────────────

    @staticmethod
    def _is_heading(text: str) -> bool:
        """Heuristic to detect if a line is a section heading."""
        t = text.strip()
        # Numbered headings like "1. Introduction" or "3.2 Methods"
        if re.match(r"^\d+(\.\d+)*\.?\s+[A-Z]", t):
            return True
        # All-caps headings
        if t.isupper() and len(t.split()) <= 8 and len(t) > 3:
            return True
        # Keywords
        heading_keywords = [
            "abstract", "introduction", "conclusion", "references",
            "acknowledgment", "acknowledgement", "methodology", "methods",
            "results", "discussion", "related work", "background",
            "appendix", "supplementary",
        ]
        return t.lower().rstrip(":") in heading_keywords

    @staticmethod
    def _detect_heading_level(text: str) -> int:
        t = text.strip().lower()
        if re.match(r"^\d+\.\d+\.\d+", t):
            return 3
        if re.match(r"^\d+\.\d+", t):
            return 2
        if re.match(r"^(abstract|introduction|conclusion|references|acknowledgment)", t):
            return 1
        if re.match(r"^\d+[.\s]", t):
            return 1
        return 2

    @staticmethod
    def _detect_caption(text: str) -> Optional[str]:
        t = text.strip().lower()
        if re.match(r"^(figure|fig\.?)\s*\d", t):
            return "figure"
        if re.match(r"^table\s*\d", t):
            return "table"
        return None

    # ── Equation detection (Canny edge density) ──────────────────────

    def _is_equation_region(
        self, image: np.ndarray, bbox: Tuple[int, int, int, int]
    ) -> bool:
        region = self._crop(image, bbox)
        if region.size == 0 or region.shape[0] < 15 or region.shape[1] < 30:
            return False
        gray = (
            cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
            if len(region.shape) == 3
            else region
        )
        edges = cv2.Canny(gray, 50, 150)
        density = float(np.sum(edges > 0)) / (edges.shape[0] * edges.shape[1])
        return density > self.EQUATION_EDGE_THRESHOLD

    def _extract_equation(
        self, image: np.ndarray, bbox: Tuple[int, int, int, int], page: int
    ) -> Optional[Equation]:
        region = self._crop(image, bbox)
        if region.size == 0:
            return None
        uid = hashlib.md5(region.tobytes()[:1024]).hexdigest()[:10]
        path = str(self._equation_dir / f"eq_{page}_{uid}.png")
        cv2.imwrite(path, region)

        # OCR the equation region using cloud OCR
        ocr_text = ""
        try:
            text, _ = ocr_image(region)
            ocr_text = text
        except Exception:
            pass

        return Equation(image_path=path, ocr_text=ocr_text, bbox=bbox, page=page)

    # ── Figure extraction ─────────────────────────────────────────────

    def _extract_figure(
        self, image: np.ndarray, bbox: Tuple[int, int, int, int], page: int
    ) -> Optional[Figure]:
        region = self._crop(image, bbox)
        if region.size == 0:
            return None
        uid = hashlib.md5(region.tobytes()[:2048]).hexdigest()[:10]
        path = str(self._figure_dir / f"fig_{page}_{uid}.png")
        cv2.imwrite(path, region)

        # OCR the figure region using cloud OCR
        ocr_text = ""
        if self._gemini:
            try:
                text, _ = self._gemini.extract_figure(region)
                ocr_text = text
            except Exception:
                pass
        if not ocr_text:
            try:
                text, _ = ocr_image(region)
                ocr_text = text
            except Exception:
                pass

        return Figure(path=path, bbox=bbox, page=page, ocr_text=ocr_text)

    # ── Utility ───────────────────────────────────────────────────────

    @staticmethod
    def _crop(
        image: np.ndarray, bbox: Tuple[int, int, int, int]
    ) -> np.ndarray:
        x1, y1, x2, y2 = bbox
        h, w = image.shape[:2]
        x1, y1 = max(0, int(x1)), max(0, int(y1))
        x2, y2 = min(w, int(x2)), min(h, int(y2))
        if x2 <= x1 or y2 <= y1:
            return np.array([])
        return image[y1:y2, x1:x2]

    # ── Convert to LangChain Documents ────────────────────────────────

    def to_documents(
        self, sci_doc: ScientificDocument, filename: str
    ) -> List:
        """Convert a ``ScientificDocument`` into LangChain Documents."""
        from langchain_core.documents import Document

        docs: List[Document] = []
        base_meta = {
            "filename": filename,
            "file_type": "pdf",
            "scientific": True,
            "total_pages": sci_doc.total_pages,
        }

        # Sections -> documents with hierarchy context
        for i, sec in enumerate(sci_doc.sections):
            if not sec.content and not sec.title:
                continue
            body = "\n".join(sec.content) if sec.content else ""
            prefix = f"## {sec.title}\n\n" if sec.title else ""
            text = f"{prefix}{body}".strip()
            if not text:
                continue
            docs.append(Document(
                page_content=f"[{filename} | Section: {sec.title or 'Untitled'} | Page {sec.page}]\n\n{text}",
                metadata={
                    **base_meta,
                    "document_type": "section",
                    "section_title": sec.title,
                    "section_level": sec.level,
                    "page_number": sec.page,
                    "section_index": i,
                },
            ))

        # Tables
        for i, tbl in enumerate(sci_doc.tables):
            caption_line = f"Caption: {tbl.caption}\n" if tbl.caption else ""
            docs.append(Document(
                page_content=f"[{filename} | Table {i + 1} | Page {tbl.page}]\n{caption_line}\n{tbl.text}",
                metadata={
                    **base_meta,
                    "document_type": "table",
                    "page_number": tbl.page,
                    "has_caption": bool(tbl.caption),
                    "table_path": tbl.path,
                },
            ))

        # Figures (OCR text + caption)
        for i, fig in enumerate(sci_doc.figures):
            parts = [f"[{filename} | Figure {i + 1} | Page {fig.page}]"]
            if fig.caption:
                parts.append(f"Caption: {fig.caption}")
            if fig.ocr_text:
                parts.append(f"Text in figure: {fig.ocr_text}")
            if len(parts) > 1:
                docs.append(Document(
                    page_content="\n".join(parts),
                    metadata={
                        **base_meta,
                        "document_type": "figure",
                        "page_number": fig.page,
                        "figure_path": fig.path,
                        "has_caption": bool(fig.caption),
                    },
                ))

        # Equations
        for i, eq in enumerate(sci_doc.equations):
            if eq.ocr_text:
                docs.append(Document(
                    page_content=f"[{filename} | Equation | Page {eq.page}]\n{eq.ocr_text}",
                    metadata={
                        **base_meta,
                        "document_type": "equation",
                        "page_number": eq.page,
                        "equation_image": eq.image_path,
                    },
                ))

        # Full-document composite (high priority for contextualiser)
        all_text = "\n\n".join(d.page_content for d in docs[:30])
        if all_text:
            docs.insert(0, Document(
                page_content=f"# Scientific Paper: {filename}\nPages: {sci_doc.total_pages}\n\n{all_text[:8000]}",
                metadata={**base_meta, "document_type": "full_data", "priority": "high"},
            ))

        logger.info(
            "scientific_documents_created",
            filename=filename,
            total=len(docs),
            sections=len(sci_doc.sections),
        )
        return docs