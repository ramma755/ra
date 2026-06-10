# Multi-Project Starter Collection

This repository contains several small coding project starters, each in its own
folder under `projects/`.

## Projects

| Project | Path | What it includes |
| --- | --- | --- |
| React app | `projects/react-app` | Vite + React single-page app |
| Node/Express API | `projects/node-express-api` | Express JSON API with health and project routes |
| Python CLI/tool | `projects/python-cli-tool` | Installable Python CLI for text utilities |
| FastAPI app | `projects/fastapi-app` | FastAPI service with typed request/response models |
| Portfolio website | `projects/portfolio-website` | Static HTML/CSS/JS portfolio |
| Game | `projects/canvas-game` | Browser canvas arcade game |
| Anything else | `projects/extra-data-dashboard` | Static data dashboard powered by JSON |

## Quick start

Each folder has its own README or manifest with commands. Common examples:

```bash
# React app
cd projects/react-app
npm install
npm run dev

# Express API
cd projects/node-express-api
npm install
npm run dev

# Python CLI
cd projects/python-cli-tool
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -e .
project-tool stats "hello from the CLI"

# FastAPI app
cd projects/fastapi-app
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -e .
fastapi-starter
```

Static projects can be opened directly in a browser or served with:

```bash
python3 -m http.server 8000
```
