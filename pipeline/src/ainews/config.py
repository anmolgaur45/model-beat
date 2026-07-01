from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_host: str
    database_port: int = 5432
    database_name: str
    database_user: str
    database_password: str
    database_ssl_ca: str = ""

    anthropic_api_key: str = ""
    # 0.38 merged topically-similar-but-distinct stories (see tasks/f1-findings.md);
    # 0.30 + the centroid check keeps multi-outlet coverage of the same story
    # while splitting topical neighbors (picked by simulation sweep on 14d of prod data)
    cluster_distance_threshold: float = 0.30
    # arXiv papers in the same subfield embed within ~0.25-0.38 of each other,
    # so they only cluster as near-duplicates
    cluster_arxiv_threshold: float = 0.10
    cluster_window_hours: int = 48

    # Cap new articles processed per run. The daily arXiv dump (~600 papers, all
    # landing in one run) otherwise pushes clustering past the 30-min Cloud Run
    # timeout, since each article costs ~9 round trips to Cloud SQL. The overflow
    # is re-fetched and drained across the day's later runs (4 runs x 250 = 1000/day
    # capacity, comfortably above daily volume). See tasks/changes.md.
    max_new_articles_per_run: int = 250

    # AI summaries (Phase J): Gemini 3.1 Flash-Lite on Vertex AI, billed to GCP
    # credits. Auth is ADC (no key). Summaries are skipped when vertex_project is
    # empty, so CI / unconfigured envs stay green (mirrors the scoring skip).
    vertex_project: str = ""
    vertex_location: str = "global"
    gemini_model: str = "gemini-3.1-flash-lite"
    summary_min_score: int = 4
    # Cap Gemini calls per run so a backlog (or the first run after launch) can't
    # push the pipeline past the Cloud Run timeout. Steady state is ~30 eligible
    # clusters/run, well under this; a backlog drains newest-first across runs.
    summary_max_per_run: int = 150

    # Model registry (Phase K): Epoch AI's free, CC-BY datasets back a canonical
    # tracker of models released in the last `model_roster_days`, with benchmark
    # scores. No LLM, no paid API — just two cheap CSV/zip fetches per run.
    model_roster_days: int = 365
    epoch_models_url: str = "https://epoch.ai/data/notable_ai_models.csv"
    epoch_benchmark_url: str = "https://epoch.ai/data/benchmark_data.zip"
    # Pricing & specs (Phase O1) from OpenRouter's public, no-auth model catalog.
    openrouter_models_url: str = "https://openrouter.ai/api/v1/models"
    # Auto-create registry rows for models released within this window that
    # OpenRouter lists but Epoch hasn't scored yet, so fresh releases appear
    # immediately (Phase O5). Epoch adopts the row once it publishes scores.
    openrouter_new_model_days: int = 60
    # Artificial Analysis free API (Phase O5): individual benchmark scores for
    # models Epoch hasn't scored yet. Fills gaps only — Epoch stays authoritative.
    # Skipped when the key is unset (CI / unconfigured envs stay green).
    aa_api_url: str = "https://artificialanalysis.ai/api/v2/data/llms/models"
    aa_api_key: str = ""

    revalidate_url: str = ""
    cron_secret: str = ""


settings = Settings()
