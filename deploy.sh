#!/bin/bash
set -euo pipefail

APP_DIR="/var/www/pdf-saas"
COMPOSE_FILE="$APP_DIR/docker-compose.yml"
ENV_FILE="$APP_DIR/.env"

echo "=== PDF SaaS Deploy ==="
echo "$(date '+%Y-%m-%d %H:%M:%S') - Starting deployment..."

# Pull latest changes from git (reset to match remote exactly)
echo "Pulling latest changes..."
git -C "$APP_DIR" fetch origin
git -C "$APP_DIR" reset --hard origin/main

# Load build-time environment. NEXT_PUBLIC_* values must exist at build time so
# `next build` can inline them into the client bundle (e.g. the Clerk publishable
# key). docker compose also auto-reads .env, but exporting here guarantees the
# build args resolve and lets us fail fast on a missing key.
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Copy env.compose.example to .env first." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

# Building without the publishable key bakes an empty key into the client bundle,
# which breaks the Clerk sign-in / sign-up buttons. Fail fast instead.
if [ -z "${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:-}" ]; then
  echo "ERROR: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is not set in $ENV_FILE." >&2
  exit 1
fi

# Rebuild and restart. The NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY build arg is declared
# in docker-compose.yml and substituted from the environment loaded above.
echo "Rebuilding and restarting containers..."
docker compose -f "$COMPOSE_FILE" down 2>/dev/null || true
docker compose -f "$COMPOSE_FILE" up -d --build

# Clean up dangling images
echo "Cleaning up old images..."
docker image prune -f

echo "$(date '+%Y-%m-%d %H:%M:%S') - Deployment complete."
