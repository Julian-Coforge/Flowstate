from fastapi import Depends, Header, HTTPException
from httpx import Client, Timeout

from app.config import Settings, get_settings

_http = Client(timeout=Timeout(10.0))


class CurrentUser:
    def __init__(self, id: str, email: str, name: str):
        self.id = id
        self.email = email
        self.name = name

    def as_dict(self) -> dict:
        return {"id": self.id, "email": self.email, "name": self.name}


def get_current_user(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Sign in required")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Sign in required")
    url = f"{settings.public_supabase_url}/auth/v1/user"
    response = _http.get(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "apikey": settings.anon_key or settings.supabase_secret_key,
        },
    )
    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="Sign in required")
    data = response.json()
    metadata = data.get("user_metadata") or {}
    name = metadata.get("name") or metadata.get("full_name") or (data.get("email") or "You").split("@")[0]
    user_id = data.get("id")
    email = data.get("email") or ""
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in required")
    return CurrentUser(id=user_id, email=email, name=name)
