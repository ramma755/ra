from __future__ import annotations

import uvicorn
from fastapi import FastAPI

from app.models import Project, ProjectCreate

app = FastAPI(
    title="FastAPI App Starter",
    summary="A simple FastAPI project API.",
    version="0.1.0",
)

projects: list[Project] = [
    Project(
        id=1,
        name="FastAPI App",
        description="Starter service with typed models.",
        status="ready",
    )
]


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.get("/projects", response_model=list[Project])
def list_projects() -> list[Project]:
    return projects


@app.post("/projects", response_model=Project, status_code=201)
def create_project(project: ProjectCreate) -> Project:
    new_project = Project(
        id=len(projects) + 1,
        name=project.name,
        description=project.description,
    )
    projects.append(new_project)
    return new_project


def run() -> None:
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)


if __name__ == "__main__":
    run()
