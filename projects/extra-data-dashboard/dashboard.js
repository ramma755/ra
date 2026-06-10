async function loadDashboard() {
  const response = await fetch("data/projects.json");

  if (!response.ok) {
    throw new Error("Unable to load dashboard data.");
  }

  return response.json();
}

function renderMetrics(projects) {
  const total = projects.length;
  const averageProgress = Math.round(
    projects.reduce((sum, project) => sum + project.progress, 0) / total,
  );
  const ready = projects.filter((project) => project.status === "ready").length;

  const metrics = [
    ["Projects", total],
    ["Average progress", `${averageProgress}%`],
    ["Ready", ready],
  ];

  document.querySelector("#metrics").innerHTML = metrics
    .map(
      ([label, value]) => `
        <article class="metric">
          <span>${label}</span>
          <strong>${value}</strong>
        </article>
      `,
    )
    .join("");
}

function renderProjects(projects) {
  document.querySelector("#project-list").innerHTML = projects
    .map(
      (project) => `
        <article class="project-row">
          <strong>${project.name}</strong>
          <div class="progress" aria-label="${project.progress}% complete">
            <span style="width: ${project.progress}%"></span>
          </div>
          <span class="status">${project.status}</span>
        </article>
      `,
    )
    .join("");
}

loadDashboard()
  .then((dashboard) => {
    renderMetrics(dashboard.projects);
    renderProjects(dashboard.projects);
    document.querySelector("#updated-at").textContent = `Updated ${dashboard.updatedAt}`;
  })
  .catch((error) => {
    document.querySelector("#project-list").textContent = error.message;
  });
