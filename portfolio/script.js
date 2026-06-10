const projects = [
  {
    title: "Autonomous Drone Control System",
    description:
      "Embedded flight-control software for a quadcopter using sensor fusion and PID controllers to improve stabilization.",
    impact: "Reduced stabilization error by 30%.",
    tags: ["Embedded systems", "PID control", "Sensor fusion", "Python"],
  },
  {
    title: "Telemetry Data Visualization Platform",
    description:
      "A real-time launch vehicle telemetry dashboard with Python, Flask, WebSockets, and interactive D3 visualizations.",
    impact: "Improved mission data visibility for engineering teams.",
    tags: ["Flask", "WebSockets", "D3.js", "Telemetry"],
  },
  {
    title: "AI Code Review Tool",
    description:
      "Prototype workflow for using large language models to assist code reviews with structured prompts and evaluation criteria.",
    impact: "Integrated review output with GitHub pull request workflows.",
    tags: ["LLMs", "Prompt engineering", "GitHub", "Code review"],
  },
];

const experience = [
  {
    role: "Senior Software Engineer",
    company: "Kennedy Space Center Contractor / Innovatech Solutions",
    years: "2015 - Present",
    bullets: [
      "Led mission-critical telemetry and control systems for launch vehicles.",
      "Designed real-time processing algorithms and automated test regimes.",
      "Mentored five engineers through reviews, debugging, and documentation practices.",
    ],
  },
  {
    role: "Software Engineer",
    company: "Sunrise Tech Solutions",
    years: "2012 - 2015",
    bullets: [
      "Built Java, Spring Boot, and Angular web applications.",
      "Designed REST APIs, integrated databases, and supported deployments.",
      "Collaborated in agile sprints with product managers and QA teams.",
    ],
  },
  {
    role: "AI & LLM Trainer",
    company: "Handshake AI Fellowship",
    years: "2025 - Present",
    bullets: [
      "Reviewed AI-generated code for correctness, efficiency, and clarity.",
      "Created coding questions, feedback rubrics, and evaluation guidelines.",
    ],
  },
];

const skills = [
  {
    title: "Languages",
    items: ["Python", "Java", "C++", "Go", "JavaScript", "SQL"],
  },
  {
    title: "Engineering",
    items: ["Architecture", "Algorithms", "Debugging", "Unit testing", "CI/CD"],
  },
  {
    title: "AI & ML",
    items: ["LLM evaluation", "Prompt engineering", "NLP basics", "Code review"],
  },
  {
    title: "Systems",
    items: ["Embedded systems", "AWS", "Azure", "Docker", "Kubernetes", "Jenkins"],
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
          <div class="tag-list">
            ${project.tags.map((tag) => `<span class="tag">${tag}</span>`).join("")}
          </div>
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
setupMenu();
