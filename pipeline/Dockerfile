FROM python:3.12.4-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 ainews

# Cache model files in a world-readable path
ENV HF_HOME=/app/.cache/huggingface

# Exact pinned dependency set (see requirements.lock for why). The CPU-only torch
# wheel lives on the PyTorch index, so it is consulted alongside PyPI. This layer
# only reinstalls when the lockfile changes.
COPY pyproject.toml requirements.lock ./
# Stub src/ so pip can read pyproject.toml metadata; real source overwrites it below
RUN mkdir -p src/ainews && touch src/ainews/__init__.py
RUN pip install --no-cache-dir -r requirements.lock \
    --extra-index-url https://download.pytorch.org/whl/cpu

# The project itself, editable so Python resolves from /app/src after COPY below.
# --no-deps: everything is pinned above. --no-build-isolation: build with the
# pinned setuptools rather than whatever is newest on PyPI at build time.
RUN pip install --no-cache-dir --no-deps --no-build-isolation -e .

# Copy real source last to maximise dep-layer cache hits
COPY src/ src/

# Pre-bake sentence-transformer model so Cloud Run startup is instant
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

# Serve that baked copy without revalidating it against the Hub. Set AFTER the
# pre-bake so the build itself can still download. The runtime HEAD requests are
# unauthenticated, and HF 429'd one on 2026-09-10: it cost a 27s retry that run
# and would have failed the embedding step outright after 5 of them.
ENV HF_HUB_OFFLINE=1

RUN chown -R ainews:ainews /app

USER ainews

ENTRYPOINT ["python", "-m", "ainews.main"]
