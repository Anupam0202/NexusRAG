# ── Stage 1: Builder ──────────────────────────────────
FROM python:3.13-slim AS builder

WORKDIR /app
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Native build tools stay in the disposable builder, never the runtime.
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    build-essential \
    libgomp1 \
    cmake \
    && rm -rf /var/lib/apt/lists/*

# Install CPU-only PyTorch FIRST (saves ~400MB vs full torch)
RUN pip install --no-cache-dir --upgrade "pip>=26.2" && \
    pip install --no-cache-dir "torch>=2.11.0" --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir "setuptools>=83.0.0"

# The application performs still-image operations, never video decoding.
# Build the reviewed headless source with FFmpeg disabled instead of shipping
# vulnerable unused video libraries inside the upstream binary wheel.
RUN ENABLE_HEADLESS=1 CMAKE_ARGS="-DWITH_FFMPEG=OFF" CMAKE_BUILD_PARALLEL_LEVEL=2 \
    pip install --no-cache-dir --no-deps "https://files.pythonhosted.org/packages/1d/99/76b7c80252aa83c1af16393454aafd125a0287101afe8deb0a6821af0e30/opencv_python_headless-5.0.0.93.tar.gz#sha256=b82f9831daab90b725c7c1ee1b36cb5732c367096ac76d119e64e14eb70d5f3c"

COPY pyproject.toml ./
# Install the rest of the deps (torch already satisfied)
RUN pip install --no-cache-dir .

# ── Stage 2: Runtime ──────────────────────────────────
FROM python:3.13-slim

WORKDIR /app
ARG SOURCE_COMMIT=unverified
LABEL org.opencontainers.image.revision=$SOURCE_COMMIT

# PDF rendering uses PyMuPDF, and image processing uses headless OpenCV.
# No executable source references Poppler, desktop GL/GLib or curl. Keep only
# the neural runtime's OpenMP dependency; revalidate real PDF/image fixtures.
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Avoid overlaying arbitrary site-packages/entrypoints on the base interpreter.
# The app and verification tools use only the isolated, reviewed runtime venv.
RUN python -m pip uninstall -y pip setuptools wheel
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY . .

RUN mkdir -p /app/data/vector_store /app/data/uploads /app/data/scientific_output /app/data/private_tmp && \
    chmod 0700 /app/data/private_tmp

ENV EMBEDDING_REVISION=1110a243fdf4706b3f48f1d95db1a4f5529b4d41

# Pre-download the embedding model at build time (avoids runtime OOM from download spikes)
RUN python -c "import os; from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2', revision=os.environ['EMBEDDING_REVISION'], trust_remote_code=False)"

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
# Defense in depth for TemporaryDirectory cleanup races; not a CVE waiver.
ENV TMPDIR=/app/data/private_tmp
# An approved self-managed runtime may override PORT.
ENV PORT=8000

USER nexusrag
CMD uvicorn main:app --host 0.0.0.0 --port $PORT --workers 1 --timeout-keep-alive 120
