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

    revalidate_url: str = ""
    cron_secret: str = ""


settings = Settings()
