import cors from "cors";
import express from "express";

const app = express();
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

const projects = [
  {
    id: "react-app",
    name: "React App",
    status: "ready",
  },
  {
    id: "node-express-api",
    name: "Node/Express API",
    status: "ready",
  },
  {
    id: "python-cli-tool",
    name: "Python CLI Tool",
    status: "ready",
  },
];

app.use(cors());
app.use(express.json());

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    service: "node-express-api-starter",
  });
});

app.get("/api/projects", (_request, response) => {
  response.json({ data: projects });
});

app.post("/api/projects", (request, response) => {
  const { id, name } = request.body;

  if (!id || !name) {
    return response.status(400).json({
      error: "Both id and name are required.",
    });
  }

  const project = {
    id,
    name,
    status: request.body.status ?? "planned",
  };

  projects.push(project);
  return response.status(201).json({ data: project });
});

app.use((request, response) => {
  response.status(404).json({
    error: `No route found for ${request.method} ${request.path}`,
  });
});

app.listen(port, () => {
  console.log(`Express API listening at http://localhost:${port}`);
});
