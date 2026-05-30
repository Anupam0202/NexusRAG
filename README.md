<p align="center">
  <img src="https://img.shields.io/badge/Python-3.11+-blue?logo=python&logoColor=white" alt="Python" />
  <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white" alt="Next.js" />
  <img src="https://img.shields.io/badge/FastAPI-0.111+-009688?logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/Gemini-Failover-4285F4?logo=google&logoColor=white" alt="Gemini" />
  <img src="https://img.shields.io/badge/FAISS-Vector_Search-FF6F00" alt="FAISS" />
  <img src="https://img.shields.io/badge/Deploy-Render_+_Vercel-000?logo=vercel&logoColor=white" alt="Deploy" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT" />
</p>

# NexusRAG — Enterprise Document Intelligence Platform

A production-grade **Retrieval-Augmented Generation** platform that lets enterprises upload documents and ask AI-powered questions grounded in their own content. Built with **FastAPI**, **Next.js 16**, and a configurable **Google Gemini failover chain**.

> **What makes it "Nexus"?** Every chunk is enriched with LLM-generated document context before embedding — dramatically improving retrieval accuracy for ambiguous passages ([Anthropic's Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval)). NexusRAG connects your documents, retrieval, and generation into a single intelligent nexus.

---

## Key Features

### Multi-Format Document Ingestion
- **PDF** — native text extraction + OCR for scanned documents
- **DOCX** — paragraphs, tables, and embedded image OCR
- **Excel / CSV** — automatic statistical summaries with multi-representation indexing
- **Images** (PNG, JPG, GIF, WebP, BMP, TIFF) — full OCR via Gemini Vision
- **TXT, Markdown, JSON** — with multi-encoding support
- Drag-and-drop upload with real-time progress
- Upload preflight returns clear limits for large PDFs, scanned PDFs, and high-resolution images before processing starts

### Advanced RAG Pipeline
- **Hybrid Retrieval** — BM25 keyword + FAISS vector semantic search with RRF fusion
- **Cross-Encoder Re-ranking** — `ms-marco-MiniLM-L-6-v2` for precision
- **Smart Chunking** — recursive, semantic (embedding-based breakpoints), and hierarchical strategies
- **Contextual Enrichment** — LLM-generated context prepended to each chunk (Anthropic-style)
- **Semantic Cache** — embedding-similarity cache avoids redundant LLM calls
- **Multi-Query Expansion** — generates alternative queries for better recall
- **Adaptive K** — query classification adjusts retrieval depth (10–50 chunks)
- **History-Aware Reformulation** — resolves pronouns using conversation context

### Cloud OCR with Auto-Recovery
- **Gemini Vision** (primary) — understanding-based extraction with typed prompts (ID cards, invoices, scientific papers)
- **Google Cloud Vision** (fallback) — pixel-level OCR with adaptive preprocessing
- **Circuit breaker with auto-recovery** — disables OCR on rate limit, re-enables after 5-minute cooldown
- **Embedded image extraction** — OCRs figures/charts inside PDFs and DOCX files
- **4 preprocessing strategies** — upscaling, CLAHE, high contrast, Otsu binarization

### Scientific PDF Parser
- Section hierarchy extraction (title, subsections, paragraphs)
- Equation detection via Canny edge-density heuristic
- Table extraction via Gemini Vision
- Figure detection with contour analysis + OCR
- Embedded image extraction via PyMuPDF
- Automatically falls back to the standard PDF loader on memory-constrained Render instances

### Real-Time Streaming Chat
- WebSocket-based token streaming with typed JSON frames
- Markdown rendering with GFM tables, code blocks, and lists
- Source attribution with expandable citation panels (framer-motion slide-in)
- Conversation memory with session management and TTL-based auto-eviction
- Confidence scoring based on actual retrieval scores

### API Key Management
- Ships with a default Gemini API key for quick start
- Auto-prompted modal when quota is exceeded
- Users can enter their own Google API key to continue
- Hot-swaps key across LLM, OCR, and enrichment singletons
- Key validated server-side using free `list_models()` call

### Runtime Settings
- Tunable temperature, top-k, hybrid alpha, context window
- Toggle re-ranking and contextual enrichment on/off
- Persistent sessions with configurable TTL

### Security
- Input sanitization (anti-prompt-injection, XSS, SQL injection detection)
- File validation with magic-byte checks (PDF, PNG, JPEG, GIF, BMP)
- PII redaction patterns (email, phone, SSN, credit card)
- Rate limiting (per-IP token bucket)
- Optional API key authentication

---

## Architecture

```
┌───────────────────────────────────────────────────────┐
│              Next.js 16 Frontend (Vercel)              │
│  ┌─────────┐ ┌───────────┐ ┌───────────┐ ┌────────┐  │
│  │   Chat   │ │ Documents │ │ Analytics │ │Settings│  │
│  │(WebSocket)│ │  (REST)   │ │  (REST)   │ │ (REST) │  │
│  └────┬─────┘ └─────┬─────┘ └─────┬─────┘ └───┬────┘  │
└───────┼─────────────┼─────────────┼────────────┼──────┘
        │             │             │            │
   wss://│        POST │         GET │       PATCH│
        ▼             ▼             ▼            ▼
┌───────────────────────────────────────────────────────┐
│              FastAPI Backend (Render)                   │
│                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │  WebSocket    │  │  REST Routes │  │  Middleware  │ │
│  │  /ws/chat     │  │  /api/v1/*   │  │  Rate Limit │ │
│  └──────┬───────┘  └──────┬───────┘  │  CORS, Auth │ │
│         │                 │          └─────────────┘ │
│  ┌──────▼─────────────────▼───────────────────────┐  │
│  │          NexusRAG Chain Orchestrator             │  │
│  │   Query → Cache → Retrieve → Prompt → Stream    │  │
│  └───┬──────────┬──────────┬──────────┬───────────┘  │
│      │          │          │          │               │
│  ┌───▼───┐ ┌───▼───┐ ┌───▼────┐ ┌───▼──────────┐   │
│  │Gemini │ │Hybrid │ │Semantic│ │ Conversation  │   │
│  │  LLM  │ │Search │ │ Cache  │ │   Memory      │   │
│  │(2.5   │ │BM25+  │ └────────┘ └──────────────┘   │
│  │Flash) │ │FAISS  │                                 │
│  └───────┘ │+Rerank│                                 │
│            └───────┘                                 │
│                                                       │
│  ┌────────────── Ingestion Pipeline ───────────────┐  │
│  │ Loader → OCR → Chunker → Enricher → Embedder   │  │
│  │ (PDF/DOCX/Excel/CSV/Image/TXT/JSON/Markdown)    │  │
│  └─────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **LLM** | Google Gemini failover chain (`gemini-2.5-flash` primary by default, fast 2.5/2.0 fallbacks) |
| **Embeddings** | Sentence Transformers (all-MiniLM-L6-v2) |
| **Re-ranker** | Cross-encoder (ms-marco-MiniLM-L-6-v2) |
| **OCR** | Gemini Vision + Google Cloud Vision |
| **Backend** | FastAPI, Uvicorn, LangChain, Pydantic v2 |
| **Frontend** | Next.js 16, React 19, TailwindCSS, Zustand, Framer Motion |
| **Vector Store** | FAISS (IndexFlatIP) + BM25Okapi |
| **Streaming** | WebSocket (native JSON frames) |
| **Deploy** | Render (backend) + Vercel (frontend) |
| **Styling** | TailwindCSS 3, Inter font, Lucide icons |

---

## Quick Start

### Prerequisites

- **Python 3.11+**
- **Node.js 18+**
- **Google API Key** — get one free at [Google AI Studio](https://aistudio.google.com/apikey)

### 1. Clone & Setup Backend

```bash
git clone https://github.com/Anupam0202/NexusRAG.git
cd NexusRAG/backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -e ".[dev]"

# Configure environment
cp .env.example .env
# Edit .env and add your GOOGLE_API_KEY
```

### 2. Setup Frontend

```bash
cd ../frontend
npm install
cp .env.example .env.local
# Edit .env.local if backend is not on localhost:8000
```

### 3. Run Both Servers

**Terminal 1 — Backend:**
```bash
cd backend
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
```

Open **http://localhost:3000** and start uploading documents!

### Docker (Alternative)

```bash
# Copy and configure backend env
cp backend/.env.example backend/.env
# Edit backend/.env and add your GOOGLE_API_KEY

docker-compose up --build
```

---

## Deployment

### Backend → Render

1. Connect your GitHub repo to [Render](https://render.com)
2. Create a **New Web Service** and select your repository
3. Render auto-detects `render.yaml` — click **Apply** to provision the service
4. Set `GOOGLE_API_KEY` in the Render dashboard (**Environment** tab)
5. Click **Deploy** — Render builds the Docker image and starts the service

`API_CORS_ORIGINS` is preconfigured in `render.yaml` for the Vercel production domains. Update it if you add a custom frontend domain.

> `render.yaml` disables scientific PDF parsing and embedded PDF image OCR on the free tier, while keeping normal text PDFs and bounded scanned-PDF OCR available.

> **Free-tier note:** Render free web services spin down after 15 minutes of inactivity and take ~30–60s to cold-start. Set `DISABLE_CROSS_ENCODER=true` (already in `render.yaml`) to stay within the 512 MB RAM limit.

### Frontend → Vercel

1. Import the repo on [Vercel](https://vercel.com)
2. Set the root directory to `frontend`
3. Add environment variable:
   - `NEXT_PUBLIC_API_URL` — your actual Render backend URL (e.g., `https://your-render-service.onrender.com`)
4. Vercel auto-detects Next.js and deploys

### Connecting Frontend and Backend

The frontend calls the Render backend directly for REST requests, uploads, and WebSocket chat streaming. This keeps every backend workflow on the same service and avoids Vercel's serverless timeout/proxy limitations.

| Connection | Path | Notes |
|---|---|---|
| REST API | Browser → Render directly | Requires `NEXT_PUBLIC_API_URL` |
| File upload | Browser → Render directly | Bypasses Vercel timeout |
| WebSocket | Browser → Render directly | Vercel doesn't proxy WS |

Make sure `API_CORS_ORIGINS` on Render includes your Vercel domain.

---

## Project Structure

```
NexusRAG/
├── backend/
│   ├── main.py                    # FastAPI entry point
│   ├── config/
│   │   └── settings.py            # Pydantic settings (env vars)
│   ├── src/
│   │   ├── api/
│   │   │   ├── routes.py          # REST endpoints
│   │   │   ├── websocket.py       # WebSocket streaming
│   │   │   ├── dependencies.py    # Singleton DI
│   │   │   ├── middleware.py      # Rate limiting, logging
│   │   │   └── models.py          # Request/response schemas
│   │   ├── generation/
│   │   │   ├── chain.py           # RAG orchestrator
│   │   │   ├── llm.py             # Gemini provider + failover
│   │   │   ├── prompts.py         # System prompt v3
│   │   │   └── memory.py          # Conversation sessions
│   │   ├── ingestion/
│   │   │   ├── pipeline.py        # Orchestrator
│   │   │   ├── loader.py          # Multi-format loaders (8 types)
│   │   │   ├── ocr_manager.py     # Gemini Vision + Cloud Vision
│   │   │   ├── chunker.py         # Smart chunking strategies
│   │   │   ├── contextualizer.py  # LLM-based enrichment
│   │   │   ├── embedder.py        # Sentence transformers
│   │   │   └── scientific.py      # Scientific PDF parser
│   │   ├── retrieval/
│   │   │   ├── retriever.py       # Hybrid BM25 + vector
│   │   │   ├── reranker.py        # Cross-encoder re-scoring
│   │   │   ├── vector_store.py    # FAISS + BM25 hybrid
│   │   │   ├── cache.py           # Semantic query cache
│   │   │   └── query_transformer.py
│   │   └── utils/
│   │       ├── exceptions.py      # Custom error hierarchy
│   │       ├── helpers.py         # Text utilities
│   │       ├── logger.py          # Structured logging
│   │       └── security.py        # Input sanitization
│   ├── scripts/
│   │   ├── evaluate.py            # RAG evaluation suite
│   │   └── ingest.py              # CLI ingestion
│   ├── tests/                     # pytest test suite
│   ├── pyproject.toml
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── app/                   # Next.js App Router pages
│   │   │   ├── chat/page.tsx      # Chat interface
│   │   │   ├── documents/page.tsx # Upload & manage
│   │   │   ├── analytics/page.tsx # System dashboard
│   │   │   ├── settings/page.tsx  # Runtime config
│   │   │   └── error.tsx          # Error boundaries
│   │   ├── components/
│   │   │   ├── chat/              # ChatInterface, MessageBubble,
│   │   │   │                      # SourcePanel, ApiKeyModal
│   │   │   ├── documents/         # UploadZone, DocumentList
│   │   │   └── layout/            # Sidebar, Header, ThemeProvider,
│   │   │                          # PageTransition
│   │   ├── hooks/                 # useChat, useStore, useDocuments
│   │   ├── lib/                   # api.ts, websocket.ts, utils.ts
│   │   └── types/                 # TypeScript definitions
│   ├── package.json
│   ├── vercel.json
│   └── Dockerfile
├── docker-compose.yml
├── render.yaml
├── Makefile
└── .gitignore
```

---

## Configuration

### Backend Environment Variables (`backend/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `GOOGLE_API_KEY` | — | Google Gemini API key **(required)** |
| `LLM_MODEL_NAME` | `gemini-2.5-flash` | Primary LLM model |
| `LLM_FALLBACK_MODELS` | `gemini-2.5-flash-lite,gemini-2.0-flash,gemini-2.0-flash-lite` | Comma-separated fallback chain |
| `EMBEDDING_MODEL` | `all-MiniLM-L6-v2` | Sentence transformer model |
| `CHUNK_SIZE` | `1000` | Target characters per chunk |
| `CHUNK_OVERLAP` | `200` | Overlap between chunks |
| `RETRIEVAL_TOP_K` | `10` | Base chunks retrieved per query |
| `SIMILARITY_THRESHOLD` | `0.25` | Minimum relevance score |
| `HYBRID_SEARCH_ALPHA` | `0.6` | Dense vs sparse weight (0–1) |
| `ENABLE_RERANKING` | `true` | Cross-encoder re-ranking |
| `ENABLE_CONTEXTUAL_ENRICHMENT` | `true` | LLM chunk enrichment |
| `ENABLE_SEMANTIC_CHUNKING` | `true` | Smart chunking routing |
| `API_CORS_ORIGINS` | `localhost:3000` | Allowed CORS origins |
| `ENABLE_CACHE` | `true` | Semantic query cache |
| `MAX_UPLOAD_SIZE_MB` | `100` | Max file upload size |
| `MAX_PDF_PAGES` | `40` | Max pages accepted per PDF upload |
| `MAX_PDF_OCR_PAGES` | `12` | Max pages for OCR-heavy or scanned PDFs |
| `PDF_OCR_DPI` | `150` | DPI used when rasterizing PDF pages for OCR |
| `ENABLE_PDF_EMBEDDED_IMAGE_OCR` | `true` | OCR embedded PDF figures/images when the instance has enough memory |
| `MAX_PDF_EMBEDDED_IMAGES` | `8` | Max embedded PDF images OCRed per upload |
| `MAX_IMAGE_MEGAPIXELS` | `25` | Max standalone image size accepted for OCR |
| `ENABLE_SCIENTIFIC_MODE` | `true` | Advanced PDF parser; disabled in `render.yaml` for Render free tier stability |

### Frontend Environment (`frontend/.env.local`)

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` locally | Render backend URL in Vercel |

---

## API Reference

### REST Endpoints (`/api/v1`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/documents/upload` | Upload & ingest a file |
| `GET` | `/documents` | List all documents |
| `DELETE` | `/documents/{filename}` | Remove a document |
| `POST` | `/chat` | Blocking RAG query |
| `POST` | `/chat/sessions/{sid}/clear` | Clear session memory |
| `GET` | `/settings` | Get current settings |
| `PATCH` | `/settings` | Update runtime settings |
| `POST` | `/apikey` | Set user API key |
| `GET` | `/analytics/summary` | System metrics |

### WebSocket (`/ws/chat`)

```json
// Client → Server
{ "question": "What is...?", "session_id": "abc", "conversation_history": [] }

// Server → Client (multiple frames)
{ "type": "token", "content": "Some text..." }
{ "type": "sources", "sources": [...] }
{ "type": "done", "metadata": { "query_type": "factual", "confidence": 0.85 } }
{ "type": "error", "content": "...", "error_code": "QUOTA_EXCEEDED" }
```

### Health Check

```
GET /health → { "status": "healthy", "version": "1.0.0", "total_chunks": 26 }
```

### Supported File Types

| Type | Extensions | Extraction Method |
|------|-----------|-------------------|
| PDF | `.pdf` | pdfplumber → Gemini Vision OCR → pypdf |
| Word | `.docx` | python-docx + embedded image OCR |
| Excel | `.xlsx`, `.xls` | pandas (4 representations per sheet) |
| CSV | `.csv` | pandas (multi-encoding detection) |
| Images | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, `.tif`, `.tiff` | Gemini Vision + Cloud Vision OCR |
| Text | `.txt`, `.md` | Direct text with encoding detection |
| JSON | `.json` | Structured + per-item documents |

PDF uploads are preflighted before ingestion. Normal text PDFs use the standard loader first; scanned PDFs use bounded OCR; scientific parsing and embedded PDF image OCR should be enabled only on larger backend instances.

---

## Rate Limit & API Key Handling

NexusRAG ships with a default API key for quick evaluation. When the free-tier quota is exhausted:

1. Backend detects `429 RESOURCE_EXHAUSTED` and sends a `QUOTA_EXCEEDED` WebSocket frame
2. Frontend shows a modal prompting the user to enter their own Google API key
3. Key is validated server-side using a free `list_models()` call
4. On success, the key is hot-swapped across all singletons (LLM, OCR, enrichment)
5. User can immediately continue chatting with their own quota

---

## RAG Pipeline Deep Dive

### Ingestion Flow
```
Upload → File Validation → Format Detection → Loader
  → OCR (if scanned/image) → Smart Chunking → Contextual Enrichment
  → Embedding (all-MiniLM-L6-v2) → FAISS Index + BM25 Index
```

### Query Flow
```
Question → Input Sanitization → Semantic Cache Check
  → Query Classification (regex, zero LLM cost)
  → Adaptive K Selection (10–50 based on query type)
  → History-Aware Reformulation (LLM)
  → Multi-Query Expansion (2 alternatives)
  → Hybrid Search (FAISS dense + BM25 sparse → RRF fusion)
  → Cross-Encoder Re-ranking (top 5)
  → Prompt Assembly (system + context + history + question)
  → Gemini Streaming Generation (with failover chain)
  → Confidence Estimation (retrieval-score-based)
  → Cache Update + Memory Update
```

### Model Failover Chain
```
gemini-2.5-flash → gemini-2.5-flash-lite → gemini-2.0-flash → gemini-2.0-flash-lite
```
Each model is tried in order. Provider-level retries are disabled so quota or model-availability failures move to the next candidate quickly instead of delaying the chat stream.

---

## Development

```bash
# Run backend tests
cd backend
pytest tests/ -v --cov

# Lint & format
ruff check src/
ruff format src/

# Type checking
mypy src/

# CLI document ingestion
python scripts/ingest.py path/to/files/

# RAG evaluation
python scripts/evaluate.py --auto --num-questions 10
```

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
