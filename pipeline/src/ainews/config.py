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
    cluster_distance_threshold: float = 0.38
    cluster_window_hours: int = 48

    revalidate_url: str = ""
    cron_secret: str = ""


settings = Settings()
