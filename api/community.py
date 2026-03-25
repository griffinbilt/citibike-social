"""GET /api/community — Get all users and their ride data for the map overlay."""

from http.server import BaseHTTPRequestHandler
import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "_lib"))
from storage import get_users, get_rides

# Lean ride fields needed for map rendering
MAP_FIELDS = [
    "origin_lat", "origin_lng", "dest_lat", "dest_lng",
    "polyline", "ride_date", "start_station", "end_station",
    "start_time", "end_time", "type",
]


def _lean_ride(ride: dict) -> dict:
    """Strip ride to only the fields needed for map rendering."""
    return {k: ride.get(k) for k in MAP_FIELDS}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            users = get_users()

            # Load rides for each user (lean format for map)
            community_rides = {}
            for user in users:
                uid = user["id"]
                rides = get_rides(uid)
                if rides:
                    community_rides[uid] = [_lean_ride(r) for r in rides if r.get("origin_lat")]

            self._json(200, {
                "users": users,
                "rides": community_rides,
            })

        except Exception as e:
            self._json(500, {"error": str(e)})

    def do_OPTIONS(self):
        self._cors_preflight()

    def _json(self, status, data):
        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Cache-Control", "public, max-age=60")

    def _cors_preflight(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()
