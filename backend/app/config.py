import re
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    supabase_url: str = ""
    next_public_supabase_url: str = ""
    next_public_supabase_anon_key: str = ""
    supabase_secret_key: str = ""
    database_url: str = ""
    cors_origins: str = "http://localhost:3000"
    openai_api_key: str = ""
    ai_model_quick: str = "gpt-4o-mini"
    ai_model_thinking: str = "gpt-4o"

    @property
    def public_supabase_url(self) -> str:
        return (self.next_public_supabase_url or self.supabase_url).rstrip("/")

    @property
    def anon_key(self) -> str:
        return self.next_public_supabase_anon_key

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def sqlalchemy_url(self) -> str:
        url = self.database_url
        direct = re.match(
            r"postgresql://postgres:([^@]+)@db\.([^.]+)\.supabase\.co:5432/postgres(.*)$",
            url,
        )
        if direct:
            password, ref, rest = direct.group(1), direct.group(2), direct.group(3)
            url = f"postgresql://postgres.{ref}:{password}@aws-0-us-east-1.pooler.supabase.com:5432/postgres{rest}"
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+psycopg://", 1)
        if "sslmode=" not in url:
            url += ("&" if "?" in url else "?") + "sslmode=require"
        return url


@lru_cache
def get_settings() -> Settings:
    return Settings()
