# Build a verified stable interpreter on the same supported LTS as the runtime.
FROM ubuntu:26.04@sha256:f144425ff09be612d6d9ad965196e9cdc23dae1f42110a8a11a3e9a8198759f7 AS python-build
ENV PYTHON_VERSION=3.14.8
ENV PYTHON_SOURCE_SHA256=c2215904f02b175596dc49351585104f4bc20341e1c47378b26a2c274360ce73
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    build-essential cmake curl ca-certificates pkg-config xz-utils \
    libssl-dev zlib1g-dev libbz2-dev libreadline-dev libsqlite3-dev \
    libffi-dev liblzma-dev libgdbm-dev libgdbm-compat-dev libexpat1-dev \
    libncurses-dev uuid-dev libzstd-dev libgomp1 libmpdec-dev \
    && rm -rf /var/lib/apt/lists/*
RUN curl --fail --show-error --location --proto '=https' --tlsv1.2 \
        "https://www.python.org/ftp/python/${PYTHON_VERSION}/Python-${PYTHON_VERSION}.tar.xz" -o /tmp/python.tar.xz \
    && printf '%s  /tmp/python.tar.xz\n' "$PYTHON_SOURCE_SHA256" | sha256sum --check --strict \
    && mkdir /tmp/python-source && tar -xJf /tmp/python.tar.xz -C /tmp/python-source --strip-components=1 \
    && cd /tmp/python-source \
    && LDFLAGS='-Wl,-rpath=/opt/python/lib' ./configure --prefix=/opt/python --enable-shared --with-ensurepip=install --with-system-libmpdec \
    && make -j2 && make install \
    && ln -s python3 /opt/python/bin/python \
    && rm -rf /tmp/python-source /tmp/python.tar.xz

# ── Stage 1: Builder ──────────────────────────────────
FROM python-build AS builder

WORKDIR /app
ENV PATH="/opt/python/bin:$PATH"
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:/opt/python/bin:$PATH"

# Native build tools stay in the disposable builder, never the runtime.
# Install CPU-only PyTorch FIRST (saves ~400MB vs full torch)
RUN pip install --no-cache-dir --upgrade "pip>=26.2" && \
    pip install --no-cache-dir "torch==2.14.1" --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir "setuptools>=83.0.0"

# The application performs still-image operations, never video decoding.
# Build the reviewed headless source with FFmpeg disabled instead of shipping
# vulnerable unused video libraries inside the upstream binary wheel.
RUN curl --fail --show-error --location --proto '=https' --tlsv1.2 \
        "https://files.pythonhosted.org/packages/1d/99/76b7c80252aa83c1af16393454aafd125a0287101afe8deb0a6821af0e30/opencv_python_headless-5.0.0.93.tar.gz#sha256=b82f9831daab90b725c7c1ee1b36cb5732c367096ac76d119e64e14eb70d5f3c" -o /tmp/opencv-source.tar.gz \
    && printf '%s  /tmp/opencv-source.tar.gz\n' 'b82f9831daab90b725c7c1ee1b36cb5732c367096ac76d119e64e14eb70d5f3c' | sha256sum --check --strict \
    && mkdir /tmp/opencv-source && tar -xzf /tmp/opencv-source.tar.gz -C /tmp/opencv-source --strip-components=1 \
    && ENABLE_HEADLESS=1 CMAKE_ARGS="-DWITH_FFMPEG=OFF" CMAKE_BUILD_PARALLEL_LEVEL=2 \
        pip install --no-cache-dir --no-deps /tmp/opencv-source \
    && rm -rf /tmp/opencv-source /tmp/opencv-source.tar.gz

COPY pyproject.toml ./
# Install the rest of the deps (torch already satisfied)
RUN pip install --no-cache-dir .

# ── Stage 2: Runtime ──────────────────────────────────
FROM ubuntu:26.04@sha256:f144425ff09be612d6d9ad965196e9cdc23dae1f42110a8a11a3e9a8198759f7

WORKDIR /app
ARG SOURCE_COMMIT=unverified
LABEL org.opencontainers.image.revision=$SOURCE_COMMIT

# PDF rendering uses PyMuPDF, and image processing uses headless OpenCV.
# Preserve interpreter extension libraries and native neural dependencies.
# Build tools, source downloads and development headers never enter this stage.
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    ca-certificates libgomp1 libstdc++6 libssl3t64 zlib1g libbz2-1.0 \
    libreadline8t64 libsqlite3-0 libffi8 liblzma5 libgdbm6t64 \
    libgdbm-compat4t64 libexpat1 libncursesw6 libtinfo6 libuuid1 libzstd1 libmpdec4 \
    && rm -rf /var/lib/apt/lists/*

# The pinned base carries an unowned launcher that NexusRAG never invokes.
# Reject unexpected ownership/content rather than remove a packaged dependency.
RUN test -f /usr/bin/pebble && test ! -L /usr/bin/pebble \
    && if dpkg-query --search /usr/bin/pebble; then exit 1; else status=$?; test "$status" -eq 1; fi \
    && printf '%s  /usr/bin/pebble\n' '5e33a1304f207bb275b1b4cc3dc4c05fdd88755f5c705e2fd569924ec72dc061' | sha256sum --check --strict \
    && rm /usr/bin/pebble && test ! -e /usr/bin/pebble

# Avoid overlaying arbitrary site-packages/entrypoints on the base interpreter.
# The app and verification tools use only the isolated, reviewed runtime venv.
COPY --from=python-build /opt/python /opt/python
RUN /opt/python/bin/python -m pip uninstall -y pip setuptools wheel
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:/opt/python/bin:$PATH"

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
