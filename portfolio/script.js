const projects = [
  {
    title: "DevTask API - REST Task Manager",
    description:
      "Production-style RESTful task management API with JWT authentication, role-based access control, CRUD workflows, and secure password handling.",
    impact: "FastAPI, PostgreSQL, Docker, and 90%+ endpoint coverage.",
    tags: ["Python", "FastAPI", "PostgreSQL", "Docker", "JWT", "Pytest"],
    link: "https://github.com/davidmuiruri/devtask-api",
    details: [
      "Built with FastAPI and SQLAlchemy ORM.",
      "Managed PostgreSQL schema changes with Alembic migrations.",
      "Added bcrypt hashing, auth middleware, and rate limiting.",
      "Containerized local and production-like environments with Docker Compose.",
    ],
  },
  {
    title: "PortfolioHub - Full-Stack Web App",
    description:
      "Developer portfolio platform for publishing projects, uploading assets, and receiving contact messages through a full-stack web workflow.",
    impact: "React, Node.js, MongoDB Atlas, AWS S3, EC2, and CI/CD.",
    tags: ["React", "Node.js", "Express", "MongoDB", "AWS S3", "GitHub Actions"],
    link: "https://github.com/davidmuiruri/portfoliohub",
    details: [
      "Implemented a responsive React frontend with hooks, context API, and Tailwind CSS.",
      "Built a Node.js/Express backend with Mongoose schema validation.",
      "Stored project assets in AWS S3 and hosted production services on EC2.",
      "Configured GitHub Actions to auto-deploy on pushes to the main branch.",
    ],
  },
  {
    title: "Pixel Dungeon - 2D Roguelike Game",
    description:
      "Top-down roguelike prototype with procedural level generation, enemy AI, inventory systems, and optimized Godot scene architecture.",
    impact: "Godot 4, GDScript, A* pathfinding, BSP generation, and 60 FPS target.",
    tags: ["Godot 4", "GDScript", "Game AI", "A* pathfinding", "BSP", "Git"],
    link: "https://github.com/davidmuiruri/pixel-dungeon",
    details: [
      "Designed modular scenes to make enemies, items, and gameplay systems easier to extend.",
      "Implemented enemy AI with A* pathfinding and combat state machines.",
      "Generated procedural dungeons with a binary space partitioning tree algorithm.",
      "Optimized performance for stable play on low-end hardware.",
    ],
  },
];

const experience = [
  {
    role: "AI Training Specialist",
    company: "Freelance / Contract (Remote) - Nairobi, Kenya",
    years: "2023 - Present",
    bullets: [
      "Evaluated AI-generated image pairs across instruction following, visual quality, and artifact detection criteria.",
      "Completed Omni R2I Elo reference-to-image editing evaluations focused on person-ID preservation and style transfer.",
      "Maintained high annotation accuracy across thousands of daily tasks with strict rubric adherence.",
    ],
  },
  {
    role: "Game Developer - Godot Engine",
    company: "Independent Projects - Nairobi, Kenya",
    years: "2021 - Present",
    bullets: [
      "Designed gameplay systems in GDScript and C# for 2D and 3D Godot projects.",
      "Built modular, reusable component architectures to reduce iteration time.",
      "Integrated art assets into game pipelines while optimizing performance and visual fidelity.",
    ],
  },
];

const skills = [
  {
    title: "Languages",
    items: ["Python", "JavaScript", "TypeScript", "GDScript", "C#", "SQL"],
  },
  {
    title: "Frameworks and libraries",
    items: ["FastAPI", "Django", "Flask", "React", "Node.js", "Express", "SQLAlchemy", "Mongoose"],
  },
  {
    title: "Databases",
    items: ["PostgreSQL", "MongoDB", "MongoDB Atlas", "SQLite", "Alembic migrations", "Indexing"],
  },
  {
    title: "Cloud and DevOps",
    items: ["AWS EC2", "AWS S3", "AWS Lambda", "IAM policies", "Docker", "Docker Compose", "GitHub Actions"],
  },
];

const tools = [
  {
    title: "REST API design",
    description:
      "OpenAPI/Swagger documentation, JWT auth, role-based access control, rate limiting, CRUD modeling, and versioning best practices.",
    items: ["FastAPI", "Express", "JWT", "bcrypt", "OpenAPI"],
  },
  {
    title: "Testing and quality",
    description:
      "Pytest suites, endpoint coverage, schema validation, pull-request checks, and CI workflows triggered on push or PR events.",
    items: ["Pytest", "GitHub Actions", "Mongoose validation", "Code review"],
  },
  {
    title: "Deployments and infrastructure",
    description:
      "Containerized services, repeatable Docker Compose stacks, cloud hosting, object storage, serverless functions, and production auto-deploys.",
    items: ["Docker", "EC2", "S3", "Lambda", "Docker Compose"],
  },
  {
    title: "Game development",
    description:
      "Godot pipelines for 2D/3D gameplay systems, procedural generation, AI pathfinding, reusable components, and performance tuning.",
    items: ["Godot 4", "GDScript", "C#", "A* pathfinding", "BSP"],
  },
];

const applicationAnswers = [
  {
    question: "Q5. Public work showing engineering ability",
    answer:
      "GitHub: github.com/davidmuiruri. Strongest samples from the resume are DevTask API, PortfolioHub, and Pixel Dungeon. Together they show REST API design, authentication, database modeling, Dockerized environments, full-stack delivery, AWS asset hosting, CI/CD, and game systems engineering.",
  },
  {
    question: "Q6. BugCrowd/HackerOne/equivalent profile",
    answer:
      "No BugCrowd, HackerOne, or equivalent public bug bounty profile was provided in the resume. If one exists, replace this note with the profile URL.",
  },
  {
    question: "Q7. Public vulnerabilities, cybersecurity OSS contributions, CVEs, or advisories",
    answer:
      "No public vulnerability reports, cybersecurity open-source code contributions, CVEs, or GitHub Security Advisories were provided in the resume. Relevant security-adjacent engineering experience includes JWT authentication, bcrypt password hashing, role-based access control, rate limiting, IAM policies, and CI/CD workflows.",
  },
  {
    question: "Q8. Strongest software engineering area",
    answer:
      "Backend and full-stack product engineering, especially REST API design, database-backed services, authentication/authorization, Dockerized deployments, and React/Node.js application delivery.",
  },
  {
    question: "Q9. Main tech stack",
    answer:
      "Languages: Python, JavaScript/TypeScript, GDScript, C#, SQL. Frameworks: FastAPI, Django, Flask, React, Node.js, Express, SQLAlchemy, Mongoose. Databases: PostgreSQL, MongoDB, SQLite. Tools: Git/GitHub, Docker, Docker Compose, AWS EC2/S3/Lambda, GitHub Actions, OpenAPI/Swagger.",
  },
  {
    question: "Q10. Testing, CI/CD, deployments, and DevOps",
    answer:
      "Experience includes Pytest endpoint suites with 90%+ reported coverage, Docker Compose multi-service stacks, GitHub Actions test/deploy pipelines triggered on push or PR events, image optimization, and auto-deploys to production from the main branch.",
  },
  {
    question: "Q11. Cloud environments",
    answer:
      "AWS experience includes EC2 hosting, S3 object storage, Lambda serverless functions, and IAM policies. PortfolioHub used S3 for file storage, EC2 for hosting, and GitHub Actions for deployment automation.",
  },
  {
    question: "Q12. SecOps/Cybersecurity",
    answer:
      "Practical security experience includes JWT auth, bcrypt password hashing, role-based access control, middleware rate limiting, schema validation, IAM policy awareness, and secure API design practices. No formal SecOps role or public bug bounty profile was listed in the resume.",
  },
];

function renderProjects() {
  const grid = document.querySelector("#project-grid");
  grid.innerHTML = projects
    .map(
      (project) => `
        <article class="project-card">
          <p class="eyebrow">${project.impact}</p>
          <h3>${project.title}</h3>
          <p>${project.description}</p>
          <ul>
            ${project.details.map((detail) => `<li>${detail}</li>`).join("")}
          </ul>
          <div class="tag-list">
            ${project.tags.map((tag) => `<span class="tag">${tag}</span>`).join("")}
          </div>
          <a class="text-link" href="${project.link}">View sample</a>
        </article>
      `,
    )
    .join("");
}

function renderExperience() {
  const list = document.querySelector("#experience-list");
  list.innerHTML = experience
    .map(
      (item) => `
        <article class="timeline-item">
          <header>
            <div>
              <strong>${item.role}</strong>
              <p>${item.company}</p>
            </div>
            <span>${item.years}</span>
          </header>
          <ul>
            ${item.bullets.map((bullet) => `<li>${bullet}</li>`).join("")}
          </ul>
        </article>
      `,
    )
    .join("");
}

function renderSkills() {
  const grid = document.querySelector("#skills-grid");
  grid.innerHTML = skills
    .map(
      (skill) => `
        <article class="skill-card">
          <h3>${skill.title}</h3>
          <div class="skill-tags">
            ${skill.items.map((item) => `<span class="tag">${item}</span>`).join("")}
          </div>
        </article>
      `,
    )
    .join("");
}

function renderTools() {
  const grid = document.querySelector("#tools-grid");
  grid.innerHTML = tools
    .map(
      (toolGroup) => `
        <article class="tool-card">
          <h3>${toolGroup.title}</h3>
          <p>${toolGroup.description}</p>
          <div class="tool-tags">
            ${toolGroup.items.map((item) => `<span class="tag">${item}</span>`).join("")}
          </div>
        </article>
      `,
    )
    .join("");
}

function renderApplicationAnswers() {
  const grid = document.querySelector("#answer-grid");
  grid.innerHTML = applicationAnswers
    .map(
      (item) => `
        <article class="answer-card">
          <h3>${item.question}</h3>
          <p>${item.answer}</p>
        </article>
      `,
    )
    .join("");
}

function setupMenu() {
  const button = document.querySelector(".menu-button");
  const nav = document.querySelector("#site-nav");

  button.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("is-open");
    button.setAttribute("aria-expanded", String(isOpen));
  });

  nav.addEventListener("click", () => {
    nav.classList.remove("is-open");
    button.setAttribute("aria-expanded", "false");
  });
}

renderProjects();
renderExperience();
renderSkills();
renderTools();
renderApplicationAnswers();
setupMenu();
