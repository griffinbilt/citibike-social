"""Vercel Blob storage helpers."""

import os
import json
import requests

BLOB_TOKEN = os.environ.get("BLOB_READ_WRITE_TOKEN", "")
BLOB_API = "https://blob.vercel-storage.com"

HEADERS = {
    "Authorization": f"Bearer {BLOB_TOKEN}",
    "x-api-version": "7",
}


def _put(pathname: str, data: dict | list) -> str:
    """Upload JSON data to Vercel Blob. Returns the public URL."""
    resp = requests.put(
        f"{BLOB_API}/{pathname}",
        data=json.dumps(data),
        headers={
            **HEADERS,
            "Content-Type": "application/json",
            "x-content-type": "application/json",
        },
    )
    resp.raise_for_status()
    return resp.json().get("url", "")


def _get(pathname: str):
    """Get JSON data from Vercel Blob by pathname. Returns None if not found."""
    resp = requests.get(
        BLOB_API,
        params={"prefix": pathname, "limit": "1"},
        headers=HEADERS,
    )
    if resp.status_code != 200:
        return None
    blobs = resp.json().get("blobs", [])
    if not blobs:
        return None
    data_resp = requests.get(blobs[0]["url"])
    if data_resp.status_code != 200:
        return None
    return data_resp.json()


def get_users() -> list[dict]:
    """Get the list of all registered users."""
    return _get("users.json") or []


def save_users(users: list[dict]):
    """Save the users list."""
    _put("users.json", users)


def upsert_user(user: dict) -> list[dict]:
    """Add or update a user in the users list. Returns updated list."""
    users = get_users()
    existing = next((u for u in users if u["id"] == user["id"]), None)
    if existing:
        existing.update(user)
    else:
        users.append(user)
    save_users(users)
    return users


def get_rides(user_id: str) -> list[dict] | None:
    """Get rides for a user."""
    return _get(f"rides/{user_id}.json")


def save_rides(user_id: str, rides: list[dict]):
    """Save rides for a user."""
    _put(f"rides/{user_id}.json", rides)
