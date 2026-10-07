# ── Stage 1: Builder ──────────────────────────────────
FROM python:3.13-slim AS builder

WORKDIR /app

# System deps for FAISS, PDF processing, and image OCR
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libglib2.0-0 \
    libgomp1 \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Install CPU-only PyTorch FIRST (saves ~400MB vs full torch)
RUN pip install --no-cache-dir --upgrade "pip>=26.2" && \
    pip install --no-cache-dir "torch>=2.11.0" --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir "setuptools>=78.1.1,<82"

COPY pyproject.toml ./
# Install the rest of the deps (torch already satisfied)
RUN pip install --no-cache-dir .

# ── Stage 2: Runtime ──────────────────────────────────
FROM python:3.13-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgomp1 \
    libgl1 \
    poppler-utils \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/lib/python3.13/site-packages /usr/local/lib/python3.13/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

COPY . .

RUN mkdir -p /app/data/vector_store /app/data/uploads /app/data/scientific_output

# Pre-download the embedding model at build time (avoids runtime OOM from download spikes)
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')"

# Keep the approved public model cache readable after privilege reduction.
ENV HF_HOME=/opt/nexusrag-models
RUN mkdir -p /opt/nexusrag-models && \
    cp -a /root/.cache/huggingface/. /opt/nexusrag-models/ && \
    useradd --create-home --uid 10001 nexusrag && \
    chown -R nexusrag:nexusrag /app/data /opt/nexusrag-models

EXPOSE 8000

# Optional self-managed/local research image; not an active Cloudflare deployment.
ENV MALLOC_TRIM_THRESHOLD_=100000
ENV PYTHONUNBUFFERED=1
# An approved self-managed runtime may override PORT.
ENV PORT=8000

USER nexusrag
CMD uvicorn main:app --host 0.0.0.0 --port $PORT --workers 1 --timeout-keep-alive 120
