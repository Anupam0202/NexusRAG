<p align="center">
  <img src="https://img.shields.io/badge/Python-3.11+-blue?logo=python&logoColor=white" alt="Python" />
  <img src="https://img.shields.io/badge/Next.js-14-black?logo=next.js&logoColor=white" alt="Next.js" />
  <img src="https://img.shields.io/badge/FastAPI-0.111+-009688?logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/Gemini_2.5-Flash-4285F4?logo=google&logoColor=white" alt="Gemini" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT" />
</p>

# ✨ NexusRAG — Enterprise Document Intelligence Platform

A production-grade **Retrieval-Augmented Generation** platform that lets enterprises upload documents and ask AI-powered questions grounded in their own content. Built with **FastAPI**, **Next.js 14**, and **Google Gemini 2.5 Flash**.

> **What makes it "Nexus"?** Every chunk is enriched with LLM-generated document context before embedding — dramatically improving retrieval accuracy for ambiguous passages ([Anthropic's Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval)). NexusRAG connects your documents, retrieval, and generation into a single intelligent nexus.

---

## 🎯 Key Features

### 📄 Multi-Format Document Ingestion
- **PDF** (native text + OCR for scanned documents)
- **DOCX**, **TXT**, **Markdown**, **JSON**
- **Excel / CSV** (with automatic statistical summaries)
- **Images** (PNG, JPG — via Gemini Vision OCR)
- Drag-and-drop upload with real-time progress

### 🧠 Advanced RAG Pipeline
- **Hybrid Retrieval** — BM25 keyword + vector semantic search
- **Cross-Encoder Re-ranking** — `ms-marco-MiniLM-L-6-v2` for precision
- **Smart Chunking** — Recursive, semantic, and hierarchical strategies
- **Contextual Enrichment** — LLM-generated context prepended to each chunk
- **Semantic Cache** — Avoids redundant LLM calls for similar queries
- **Multi-Query Expansion** — Generates alternative queries for better recall

### 🔍 Cloud OCR (No PaddleOCR)
- **Gemini Vision** (primary) — understanding-based extraction
- **Google Cloud Vision** (fallback) — pixel-level OCR
- **Adaptive preprocessing** — upscaling, CLAHE, Otsu binarization
- **Circuit breaker** — disables OCR on rate limit to avoid cascading failures

### 💬 Real-Time Streaming Chat
- WebSocket-based token streaming
- Markdown rendering with GFM tables, code blocks, lists
- Source attribution with expandable citation panels
- Conversation memory with session management

### 🔑 API Key Management
- Ships with a default Gemini API key for quick start
- **Auto-prompted modal** when quota is exceeded
- Users can enter their own Google API key to continue
- Hot-swaps key across LLM, OCR, and enrichment singletons

### ⚙️ Runtime Settings
- Tunable temperature, top-k, hybrid alpha, context window
- Toggle re-ranking and contextual enrichment on/off
- Persistent sessions with configurable TTL

---

## 🏗️ Architecture

```
┌───────────────────────────────────────────────────────┐
│                   Next.js 14 Frontend                 │
│  ┌─────────┐ ┌───────────┐ ┌───────────┐ ┌────────┐  │
│  │   Chat   │ │ Documents │ │ Analytics │ │Settings│  │
│  │(WebSocket)│ │  (REST)   │ │  (REST)   │ │ (REST) │  │
│  └────┬─────┘ └─────┬─────┘ └─────┬─────┘ └───┬────┘  │
└───────┼─────────────┼─────────────┼────────────┼──────┘
        │             │             │            │
   ws://│        POST │         GET │       PATCH│
        ▼             ▼             ▼            ▼
┌───────────────────────────────────────────────────────┐
│                 FastAPI Backend (:8000)                │
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
│  └───────┘ │BM25+  │ └────────┘ └──────────────┘   │
│            │Vector │                                 │
│            │+Rerank│                                 │
│            └───────┘                                 │
│                                                       │
│  ┌────────────── Ingestion Pipeline ───────────────┐  │
│  │ Loader → OCR → Chunker → Enricher → Embedder   │  │
│  └─────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites

- **Python 3.11+**
- **Node.js 18+**
- **Google API Key** — get one free at [Google AI Studio](https://aistudio.google.com/apikey)

### 1. Clone & Setup Backend

```bash
git clone https://github.com/Anupam0202/NexusRAG.git
cd nexus-rag/backend

# Create virtual environment
python -m venv venv
# Windows
venv\Scripts\activate
# macOS/Linux
source venv/bin/activate

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
docker-compose up --build
```

---

## 📁 Project Structure

```
nexus-rag/
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
│   │   │   └── models.py         # Request/response schemas
│   │   ├── generation/
│   │   │   ├── chain.py           # RAG orchestrator
│   │   │   ├── llm.py            # Gemini provider + retry
│   │   │   ├── prompts.py        # System prompt v3
│   │   │   └── memory.py         # Conversation sessions
│   │   ├── ingestion/
│   │   │   ├── pipeline.py       # Orchestrator
│   │   │   ├── loader.py         # Multi-format loaders
│   │   │   ├── ocr_manager.py    # Gemini Vision + Cloud Vision
│   │   │   ├── chunker.py        # Smart chunking strategies
│   │   │   ├── contextualizer.py # LLM-based enrichment
│   │   │   ├── embedder.py       # Sentence transformers
│   │   │   └── scientific.py     # Scientific PDF parser
│   │   ├── retrieval/
│   │   │   ├── retriever.py      # Hybrid BM25 + vector
│   │   │   ├── reranker.py       # Cross-encoder re-scoring
│   │   │   ├── vector_store.py   # ChromaDB / FAISS
│   │   │   ├── cache.py          # Semantic query cache
│   │   │   └── query_transformer.py
│   │   └── utils/
│   │       ├── exceptions.py     # Custom error hierarchy
│   │       ├── helpers.py        # Text utilities
│   │       ├── logger.py         # Structured logging
│   │       └── security.py       # Input sanitization
│   ├── scripts/
│   │   ├── evaluate.py           # RAG evaluation suite
│   │   └── ingest.py             # CLI ingestion
│   ├── pyproject.toml
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── app/                  # Next.js App Router pages
│   │   │   ├── chat/page.tsx     # Chat interface
│   │   │   ├── documents/page.tsx # Upload & manage
│   │   │   ├── analytics/page.tsx # System dashboard
│   │   │   └── settings/page.tsx  # Runtime config
│   │   ├── components/
│   │   │   ├── chat/             # ChatInterface, MessageBubble, ApiKeyModal
│   │   │   ├── documents/        # UploadZone, DocumentList
│   │   │   ├── analytics/        # Dashboard
│   │   │   └── layout/           # Sidebar, Header, ThemeProvider
│   │   ├── hooks/                # useChat, useStore, useDocuments
│   │   ├── lib/                  # api.ts, websocket.ts, utils.ts
│   │   └── types/                # TypeScript definitions
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml
├── Makefile
└── .gitignore
```

---

## 🔧 Configuration

### Environment Variables (`backend/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `GOOGLE_API_KEY` | — | Google Gemini API key (required) |
| `LLM_MODEL_NAME` | `gemini-2.5-flash` | Primary LLM model |
| `EMBEDDING_MODEL` | `sentence-transformers/all-MiniLM-L6-v2` | Embeddings model |
| `CHUNK_SIZE` | `1000` | Token chunk size |
| `CHUNK_OVERLAP` | `200` | Overlap between chunks |
| `RETRIEVAL_TOP_K` | `10` | Documents retrieved per query |
| `ENABLE_RERANKING` | `true` | Cross-encoder re-ranking |
| `ENABLE_CONTEXTUAL_ENRICHMENT` | `true` | LLM chunk enrichment |
| `ENABLE_SEMANTIC_CHUNKING` | `true` | Smart chunking routing |
| `CORS_ORIGINS` | `["http://localhost:3000"]` | Allowed CORS origins |

### Frontend Environment (`frontend/.env.local`)

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Backend URL |

---

## 📡 API Reference

### REST Endpoints (`/api/v1`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/documents/upload` | Upload & ingest a file |
| `GET` | `/documents` | List all documents |
| `DELETE` | `/documents/{filename}` | Remove a document |
| `POST` | `/chat` | Blocking RAG query |
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

---

## 🛡️ Rate Limit & API Key Handling

NexusRAG ships with a default API key for quick evaluation. When the free-tier quota (5 RPM) is exhausted:

1. Backend detects `429 RESOURCE_EXHAUSTED` and sends a `QUOTA_EXCEEDED` WebSocket frame
2. Frontend shows a modal prompting the user to enter their own Google API key
3. Key is validated server-side using a free `list_models()` call (no API credits consumed)
4. On success, the key is hot-swapped across all singletons (LLM, OCR, enrichment)
5. User can immediately continue chatting with their own quota

---

## 🧪 Development

```bash
# Run backend tests
cd backend
pytest tests/ -v --cov

# Lint & format
ruff check src/
ruff format src/

# Type checking
mypy src/
```

---

## 📋 Tech Stack

| Layer | Technology |
|-------|-----------|
| **LLM** | Google Gemini 2.5 Flash |
| **Embeddings** | Sentence Transformers (all-MiniLM-L6-v2) |
| **Re-ranker** | Cross-encoder (ms-marco-MiniLM-L-6-v2) |
| **OCR** | Gemini Vision + Google Cloud Vision |
| **Backend** | FastAPI, Uvicorn, LangChain |
| **Frontend** | Next.js 14, React 18, TailwindCSS, Zustand |
| **Vector Store** | FAISS + BM25Okapi |
| **Streaming** | WebSocket (native) |
| **Styling** | TailwindCSS 3, Inter font, Lucide icons |

---

## 📜 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
