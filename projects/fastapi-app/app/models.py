from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, examples=["Customer Portal"])
    description: str = Field(default="", examples=["A useful project."])


class Project(ProjectCreate):
    id: int
    status: str = "planned"
