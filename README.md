# WiserFiles (PDF SaaS Tool Suite)

WiserFiles is a Next.js App Router project that exposes a full iLovePDF-style tool directory with per-tool workspaces.

## Included tool functions

The dashboard includes all major expected PDF workflow functions in one searchable interface:

- Organize: Merge PDF, Split PDF, Organize PDF, Rotate PDF, Remove Pages, Extract Pages
- Optimize: Compress PDF, Repair PDF, OCR PDF, PDF to PDF-A
- Convert: PDF to Word, PDF to PowerPoint, PDF to Excel, Word to PDF, PowerPoint to PDF, Excel to PDF, PDF to JPG, JPG to PDF, HTML to PDF
- Security: Protect PDF, Unlock PDF, Redact PDF
- Edit: Watermark PDF, Page Numbers, Edit PDF, Crop PDF
- Sign: Sign PDF, Compare PDF, Scan to PDF

## Runtime behavior

- Client-executed now: Merge PDF, Split PDF, Rotate PDF, JPG to PDF, Watermark PDF, Page Numbers
- Server-executed now: OCR PDF, which runs OCRmyPDF and returns a searchable PDF with an embedded text layer
- Other server pipeline placeholders: conversion, encryption, signature, and deep editing operations that require backend services

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Quality checks

```bash
npm run lint
npm run build
```

## OCR requirements

- The OCR route depends on OCRmyPDF plus `tesseract-ocr`, `ghostscript`, and `qpdf` on the server.
- The provided Dockerfile installs those packages for the production container.
- The UI currently exposes English, German, French, Spanish, Italian, Portuguese, Dutch, and Polish OCR profiles and passes the selected language to OCRmyPDF with `-l`.
- OCR uploads larger than 1 GB are rejected in the UI before processing and by the API route as a server-side backstop.

## LaTeX compile requirements

- Research Studio server compile (`/api/latex-compile`) now tries `texliveonfly` first, then falls back to `tectonic` and `latexmk`.
- The compile route attempts `tlmgr` auto-install for missing `.sty` dependencies; on Debian/Ubuntu it detects TeX Live year mismatch and retries with the matching historic TeX Live repository (for example `.../texlive/2023/tlnet-final`).
- If `tlmgr` still fails, it tries an `apt-get` install using known package mappings (for example `siunitx.sty` -> `texlive-science`) and retries compile.
- `apt-get` auto-install is attempted only when the server process runs as root (common in containers). If the process is non-root, `apt-get` fallback is skipped and the response includes the exact reason plus a manual install hint.
- The provided Dockerfile installs `texlive-extra-utils` (for `texliveonfly`), `latexmk`, `texlive-latex-base`, `texlive-latex-recommended`, and `texlive-fonts-recommended`.
- For local (non-Docker) development on Debian/Ubuntu, install:

```bash
sudo apt-get update
sudo apt-get install -y texlive-extra-utils latexmk texlive-latex-base texlive-latex-recommended texlive-fonts-recommended
```

- If you are running via Docker, rebuild and restart after dependency changes:

```bash
docker compose build --no-cache
docker compose up -d
```

## DeepSeek AI compile suggestions

- Research Studio can request AI-assisted compile-log fixes from `/api/latex-fix-suggestions` and render suggestions in the preview pane.
- Configure server environment variables before using this feature:

```bash
DEEPSEEK_API_KEY=your_api_key
# Optional overrides
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_API_URL=https://api.deepseek.com/chat/completions
```

- The API sends the current compile log plus editable project files to DeepSeek and expects structured JSON fix suggestions.

### Docker Compose env wiring

- `docker-compose.yml` forwards DeepSeek vars into the `web` service using `${...}` substitution.
- `docker-compose.yml` also builds `DATABASE_URL` from `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD`, and targets the in-stack `db` service (`@db:5432`) for portability.
- `web` supports both local build and prebuilt image flows via `WEB_IMAGE`.
- Create a root `.env` file (gitignored) before `docker compose up`.
- A template is provided at `env.compose.example`:

```bash
cp env.compose.example .env
docker compose up -d --build
```

- You can also override at runtime without editing files:

```bash
DEEPSEEK_API_KEY=your_key docker compose up -d --build
```

- The reverse proxy network defaults to `docker_webnet` and can be overridden with `WEB_EXTERNAL_NETWORK`.

### Deploy workflows

Use `deploy.sh` with one of two modes:

- `DEPLOY_MODE=git` (default): server pulls `origin/main`, then runs `docker compose up -d --build`.
- `DEPLOY_MODE=registry`: server pulls prebuilt `WEB_IMAGE`, then runs `docker compose up -d` without building.

Optional git pinning variables for `DEPLOY_MODE=git`:

- `DEPLOY_GIT_REMOTE` (default `origin`)
- `DEPLOY_GIT_REF` (default `main`, but can also be a tag or commit SHA)

#### 1) Git-based deploy (push first, then deploy)

On your local machine:

```bash
git add .
git commit -m "your change"
git push origin main
```

On the VPS:

```bash
cd /var/www/pdf-saas
./deploy.sh
```

#### 2) Registry-based deploy (push image first, then deploy)

Build and push from CI or local machine:

```bash
docker build -t ghcr.io/your-org/pdf-saas-web:main \
	--build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_publishable_key \
	.
docker push ghcr.io/your-org/pdf-saas-web:main
```

On the VPS `.env`:

```bash
DEPLOY_MODE=registry
WEB_IMAGE=ghcr.io/your-org/pdf-saas-web:main
```

Then deploy:

```bash
cd /var/www/pdf-saas
./deploy.sh
```

### Local release helper

Use `release.sh` on your local machine to automate commit/push and registry publishing.

Prepare `.env` locally with:

- `WEB_IMAGE_REPO` (for registry/all mode), for example `ghcr.io/your-org/pdf-saas-web`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (required for image build arg)

Examples:

```bash
# Commit + push git only
./release.sh --mode git --commit "feat: improve deploy flow"

# Build + push image only (tag defaults to current short git SHA)
./release.sh --mode registry

# Commit + push git + build/push image + latest tag
./release.sh --mode all --commit "chore: release" --latest
```

After a registry release, set on VPS:

```bash
DEPLOY_MODE=registry
WEB_IMAGE=ghcr.io/your-org/pdf-saas-web:<tag>
```

After a git release, you can optionally pin deploy to a specific commit:

```bash
DEPLOY_MODE=git
DEPLOY_GIT_REF=<commit-sha-or-tag>
```

### One-command release-to-live helper

Use `ship.sh` on your local machine to optionally publish an image and then deploy it to VPS over SSH in one command.

Optional local `.env` defaults for this helper:

- `DEPLOY_SSH_TARGET` (for example `johns@idealsoftwaresolutions`)
- `DEPLOY_SSH_PORT` (default `22`)
- `DEPLOY_SSH_IDENTITY` (path to private key, optional)
- `DEPLOY_APP_DIR` (default `/var/www/pdf-saas`)

Common usage:

```bash
# Commit + push + publish + deploy in one command
./ship.sh --commit "chore: release" --publish

# Strict commit mode: fail if there are no local changes
./ship.sh --commit-all "chore: release" --publish

# Publish image (tag defaults to current short git SHA), then deploy that tag
./ship.sh --publish

# Publish and deploy an explicit tag
./ship.sh --publish --tag main

# Deploy an already-pushed image directly
./ship.sh --image ghcr.io/your-org/pdf-saas-web:abc1234
```

Commit policy options:

- `--commit "message"`: best-effort commit; continues even if nothing new is committed.
- `--commit-all "message"`: strict mode; exits with error when there are no local changes.

What `ship.sh` does remotely:

- Updates VPS `.env` with `DEPLOY_MODE=registry`
- Updates VPS `.env` with `WEB_IMAGE=<your image>`
- Runs `./deploy.sh`

### Docker data persistence

- Postgres is bind-mounted to `./data/postgres` via `docker-compose.yml`.
- This keeps account/project data outside the container filesystem, so recreating containers is safe.
- Do not delete `./data/postgres` unless you intentionally want to reset database state.

### LaTeX packages in container

- The `web` image installs LaTeX toolchain packages during build, including:
	- `latexmk`
	- `texlive-latex-base`
	- `texlive-latex-recommended`
	- `texlive-fonts-recommended`
- Additional support packages are also installed (`texlive-extra-utils`, `texlive-science`).

## Notes

- The tool hub is fully accessible from the home dashboard via search, category filters, and direct links.
- Production hardening should add auth, storage, queue workers, and usage limits for server-side tools.
