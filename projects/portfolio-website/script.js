const projects = [
  {
    name: "Launch Kit",
    type: "Product design",
    description: "A clean dashboard for tracking a product launch.",
  },
  {
    name: "Signal Studio",
    type: "Web app",
    description: "A responsive interface for exploring real-time metrics.",
  },
  {
    name: "Field Notes",
    type: "Content system",
    description: "A publishing workflow for research and case studies.",
  },
];

const grid = document.querySelector("#project-grid");

grid.innerHTML = projects
  .map(
    (project) => `
      <article class="project-card">
        <span>${project.type}</span>
        <h3>${project.name}</h3>
        <p>${project.description}</p>
      </article>
    `,
  )
  .join("");
