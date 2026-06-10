const features = [
  "Component-based UI",
  "Responsive layout",
  "Ready for API integration",
];

export default function App() {
  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">React starter</p>
        <h1>Build a polished web app from a clean Vite setup.</h1>
        <p className="hero-copy">
          This starter keeps the structure small while giving you a useful
          landing page, reusable data, and a clear place to add features.
        </p>
        <div className="actions">
          <a href="https://react.dev" target="_blank" rel="noreferrer">
            React docs
          </a>
          <a href="https://vite.dev" target="_blank" rel="noreferrer">
            Vite docs
          </a>
        </div>
      </section>

      <section className="card-grid" aria-label="Starter features">
        {features.map((feature) => (
          <article className="card" key={feature}>
            <h2>{feature}</h2>
            <p>
              Replace this card with your own content, state, and data-fetching
              logic as the app grows.
            </p>
          </article>
        ))}
      </section>
    </main>
  );
}
