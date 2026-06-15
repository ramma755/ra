# David Muiruri Portfolio

This repository contains a static portfolio website built from the uploaded
resume details.

## Portfolio

The main portfolio is in `portfolio/` and includes David Muiruri's resume
content, work samples, public links, technical stack, experience, education,
availability, and application answers for Q5 through Q12.

Open the site locally:

```bash
cd portfolio
python3 -m http.server 8000
```

Then visit `http://127.0.0.1:8000`.

## Extra templates

The portfolio includes six additional templates in `portfolio/templates/`:

- 3 gaming portfolios
- 3 software engineering portfolios

Open `portfolio/templates/index.html` to browse them.

## Free hosting

The portfolio can be hosted for free with GitHub Pages, Netlify, Cloudflare
Pages, or Vercel. The existing GitHub Actions workflow deploys the `portfolio/`
folder to GitHub Pages after changes are merged to `main` and Pages is set to
use GitHub Actions. See `portfolio/README.md` for setup steps.
