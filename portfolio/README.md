# Shanice Jones Portfolio

A static portfolio website built from the resume details. It uses plain HTML,
CSS, and JavaScript, so it can be hosted for free without a backend.

## Engineering tools included

The main portfolio includes an engineering toolkit section with CAD, BIM,
simulation, electronics, visualization, and game/media tools:

- KiCad
- LTspice
- Ngspice
- Qucs-S
- FreeCAD (BIM/IFC)
- LibreCAD
- OpenSCAD
- Vectorworks
- ParaView
- 3D Slicer
- Defold
- Solar2D
- Panda3D
- Lightworks

## Run locally

```bash
python3 -m http.server 8000
```

Open `http://127.0.0.1:8000`.

## Portfolio templates

The `templates/` folder contains six additional static portfolio options:

### Gaming portfolios

- `templates/gaming-esports.html` - competitive esports player portfolio
- `templates/gaming-developer.html` - game developer portfolio
- `templates/gaming-streamer.html` - streamer and gaming creator portfolio

### Software engineering portfolios

- `templates/software-fullstack.html` - full-stack software engineer portfolio
- `templates/software-backend-cloud.html` - backend and cloud engineer portfolio
- `templates/software-ai-ml.html` - AI and ML engineer portfolio

Open `templates/index.html` in the browser to browse all six from one gallery.
When hosted, the gallery will be available at `/templates/`.

## Before publishing

The main portfolio contact button currently uses this public email:

```html
<a class="button primary" href="mailto:rammarieirez@gmail.com">rammarieirez@gmail.com</a>
```

If you want a different contact method later, replace it with the public email,
LinkedIn, or GitHub profile you want visitors to use.

```html
<a class="button primary" href="https://github.com/username">View GitHub profile</a>
```

## Free hosting options

### Option 1: GitHub Pages

This repo includes `.github/workflows/deploy-portfolio.yml`, which publishes the
`portfolio/` folder to GitHub Pages.

After this branch is merged:

1. Go to the repository on GitHub.
2. Open **Settings** > **Pages**.
3. Under **Build and deployment**, choose **GitHub Actions**.
4. Push or merge to `main`.
5. Wait for the "Deploy portfolio to GitHub Pages" workflow to finish.

The site will be available at:

```text
https://<your-github-username>.github.io/<repo-name>/
```

For this repository, that should be:

```text
https://ramma755.github.io/ra/
```

### Option 2: Netlify

1. Create a free Netlify account.
2. Choose **Add new site** > **Import an existing project**.
3. Connect GitHub and select this repository.
4. Set the publish directory to `portfolio`.
5. Deploy.

### Option 3: Cloudflare Pages

1. Create a free Cloudflare account.
2. Go to **Workers & Pages** > **Create application** > **Pages**.
3. Connect this GitHub repository.
4. Set the build command to blank and output directory to `portfolio`.
5. Deploy.

### Option 4: Vercel

1. Create a free Vercel account.
2. Import this GitHub repository.
3. Set the output directory to `portfolio`.
4. Deploy.
