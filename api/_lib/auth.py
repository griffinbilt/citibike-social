"""Google access token verification via userinfo endpoint."""

import requests

GOOGLE_USERINFO = "https://www.googleapis.com/oauth2/v3/userinfo"


def verify_google_token(access_token: str) -> dict | None:
    """Verify a Google access token by calling userinfo. Returns user info or None."""
    resp = requests.get(GOOGLE_USERINFO, headers={"Authorization": f"Bearer {access_token}"})
    if resp.status_code != 200:
        return None
    info = resp.json()
    if "sub" not in info or "email" not in info:
        return None
    return {
        "id": info["sub"],
        "email": info["email"],
        "name": info.get("name", info["email"].split("@")[0]),
        "picture": info.get("picture", ""),
    }
