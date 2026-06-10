from __future__ import annotations

import json
import time
from pathlib import Path

from flask import Flask, jsonify, send_from_directory
from flask_sock import Sock

from telemetry_dashboard.generator import TelemetryGenerator

STATIC_DIR = Path(__file__).resolve().parent / "static"


def create_app() -> Flask:
    app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="/static")
    sock = Sock(app)
    generator = TelemetryGenerator()

    @app.get("/")
    def index():
        return send_from_directory(STATIC_DIR, "index.html")

    @app.get("/health")
    def health():
        return jsonify({"ok": True, "service": "telemetry-dashboard"})

    @app.get("/api/snapshot")
    def snapshot():
        return jsonify({"data": generator.snapshot()})

    @sock.route("/ws/telemetry")
    def telemetry_stream(ws):
        mission_time = 0.0
        while True:
            ws.send(json.dumps(generator.frame_at(mission_time).to_dict()))
            mission_time += 1
            time.sleep(1)

    return app


def main() -> None:
    app = create_app()
    app.run(host="127.0.0.1", port=5000, debug=True)


if __name__ == "__main__":
    main()
