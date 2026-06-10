# FastAPI App Starter

A typed FastAPI service with health, list, and create endpoints.

## Run

```bash
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -e .
fastapi-starter
```

## Endpoints

- `GET /health`
- `GET /projects`
- `POST /projects`

Interactive docs are available at `http://127.0.0.1:8000/docs`.
