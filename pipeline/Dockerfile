FROM python:3.12.4-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 ainews

# Cache model files in a world-readable path
ENV HF_HOME=/app/.cache/huggingface

# Install CPU-only torch first — separate layer, rarely invalidated
COPY pyproject.toml .
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

# Install remaining deps — invalidated only when pyproject.toml changes
RUN pip install --no-cache-dir .

# Copy source after deps to maximize cache hits
COPY src/ src/

# Pre-bake sentence-transformer model so Cloud Run startup is instant
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

RUN chown -R ainews:ainews /app

USER ainews

ENTRYPOINT ["python", "-m", "ainews.main"]
