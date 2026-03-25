"""POST /api/save_rides — Store rides for an authenticated user."""

from http.server import BaseHTTPRequestHandler
import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "_lib"))
from auth import verify_google_token
from storage import save_rides, upsert_user


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            # Verify auth
            auth_header = self.headers.get("Authorization", "")
            if not auth_header.startswith("Bearer "):
                return self._error(401, "Missing authorization")

            token = auth_header.split("Bearer ", 1)[1]
            user = verify_google_token(token)
            if not user:
                return self._error(401, "Invalid token")

            # Parse body
            content_length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_length))
            rides = body.get("rides", [])

            if not rides:
                return self._error(400, "No rides provided")

            # Store rides
            save_rides(user["id"], rides)

            # Update user record
            upsert_user({
                "id": user["id"],
                "name": user["name"],
                "email": user["email"],
                "picture": user["picture"],
                "rideCount": len(rides),
            })

            self._json(200, {"ok": True, "rideCount": len(rides)})

        except Exception as e:
            self._error(500, str(e))

    def do_OPTIONS(self):
        self._cors_preflight()

    def _json(self, status, data):
        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _error(self, status, msg):
        self._json(status, {"error": msg})

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")

    def _cors_preflight(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()
