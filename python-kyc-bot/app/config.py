from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_env: str = "development"
    app_port: int = 8080
    app_base_url: str = "http://localhost:8080"
    database_url: str = "sqlite:///./kyc_test_bot.db"
    test_profiles_file: str = "./profiles.json"

    persona_api_key: str = "NONE"
    persona_template_id: str = "NONE"
    persona_base_url: str = "https://withpersona.com/api/v1"
    persona_webhook_secret: str = "NONE"
    always_success_mode: bool = True
    auto_complete_on_start: bool = True


settings = Settings()
