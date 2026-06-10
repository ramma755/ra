# Resume Project Portfolio

These projects are based on the "Selected Projects" section of the uploaded
resume.

## 1. Autonomous Drone Control System

Path: `autonomous-drone-control-system`

Simulates a quadcopter flight controller with:

- PID controllers for roll, pitch, and altitude
- Complementary sensor fusion for noisy gyroscope and accelerometer readings
- A command-line simulation that reports stabilization error

```bash
cd autonomous-drone-control-system
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -e .
drone-sim --seconds 8
```

## 2. Telemetry Data Visualization Platform

Path: `telemetry-data-visualization-platform`

Provides a Flask dashboard with:

- Simulated launch vehicle telemetry
- WebSocket streaming with `flask-sock`
- D3-powered charts in the browser
- JSON snapshot endpoint for integration tests or external clients

```bash
cd telemetry-data-visualization-platform
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -e .
telemetry-dashboard
```

Then open `http://127.0.0.1:5000`.

## 3. AI Code Review Tool

Path: `ai-code-review-tool`

Implements a local prototype for AI-assisted code review workflows:

- Scores Python files and diffs against structured review criteria
- Flags maintainability, reliability, and testability risks
- Generates a GitHub pull request comment payload
- Includes prompt templates that can be adapted for LLM-backed review

```bash
cd ai-code-review-tool
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -e .
ai-review examples/sample_pr.diff --format markdown
```
