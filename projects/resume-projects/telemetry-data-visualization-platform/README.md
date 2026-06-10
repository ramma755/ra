# Telemetry Data Visualization Platform

Resume source: "Built a web-based dashboard to visualize and analyze launch
vehicle telemetry in real time. Utilized Python, Flask, WebSockets, and D3.js
for interactive graphs."

This project streams simulated launch vehicle telemetry to a browser dashboard.

## Features

- Flask app with health and snapshot endpoints
- WebSocket telemetry stream with `flask-sock`
- D3 line chart for altitude and velocity
- Status cards for engine temperature, fuel, acceleration, and mission phase

## Run

```bash
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -e .
telemetry-dashboard
```

Open `http://127.0.0.1:5000`.

## API

- `GET /health`
- `GET /api/snapshot`
- `WS /ws/telemetry`
