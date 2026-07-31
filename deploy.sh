#!/bin/bash
set -euo pipefail

APP_DIR="/var/www/pdf-saas"
COMPOSE_FILE="$APP_DIR/docker-compose.yml"
ENV_FILE="$APP_DIR/.env"
WEB_EXTERNAL_NETWORK_DEFAULT="docker_webnet"
DEPLOY_MODE_DEFAULT="git"
DEPLOY_GIT_REMOTE_DEFAULT="origin"
DEPLOY_GIT_REF_DEFAULT="main"

echo "=== PDF SaaS Deploy ==="
echo "$(date '+%Y-%m-%d %H:%M:%S') - Starting deployment..."

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

# Validate DB inputs used by compose to construct DATABASE_URL.
if [ -z "${POSTGRES_DB:-}" ] || [ -z "${POSTGRES_USER:-}" ] || [ -z "${POSTGRES_PASSWORD:-}" ]; then
  echo "ERROR: POSTGRES_DB, POSTGRES_USER, and POSTGRES_PASSWORD must be set in $ENV_FILE." >&2
  exit 1
fi

# Ensure the external proxy network exists before compose startup.
WEB_EXTERNAL_NETWORK="${WEB_EXTERNAL_NETWORK:-$WEB_EXTERNAL_NETWORK_DEFAULT}"
if ! docker network inspect "$WEB_EXTERNAL_NETWORK" >/dev/null 2>&1; then
  echo "Creating missing external network: $WEB_EXTERNAL_NETWORK"
  docker network create "$WEB_EXTERNAL_NETWORK"
fi

DEPLOY_MODE="${DEPLOY_MODE:-$DEPLOY_MODE_DEFAULT}"
DEPLOY_GIT_REMOTE="${DEPLOY_GIT_REMOTE:-$DEPLOY_GIT_REMOTE_DEFAULT}"
DEPLOY_GIT_REF="${DEPLOY_GIT_REF:-$DEPLOY_GIT_REF_DEFAULT}"

case "$DEPLOY_MODE" in
  git)
    # Pull latest changes from git and reset to an explicit ref.
    echo "Fetching updates from $DEPLOY_GIT_REMOTE and resolving ref '$DEPLOY_GIT_REF'..."
    git -C "$APP_DIR" fetch "$DEPLOY_GIT_REMOTE" --tags

    if git -C "$APP_DIR" rev-parse --verify --quiet "refs/remotes/$DEPLOY_GIT_REMOTE/$DEPLOY_GIT_REF" >/dev/null; then
      TARGET_REF="$DEPLOY_GIT_REMOTE/$DEPLOY_GIT_REF"
    else
      TARGET_REF="$DEPLOY_GIT_REF"
    fi

    git -C "$APP_DIR" rev-parse --verify --quiet "$TARGET_REF" >/dev/null || {
      echo "ERROR: Could not resolve deploy ref '$DEPLOY_GIT_REF'." >&2
      exit 1
    }

    echo "Resetting repository to $TARGET_REF"
    git -C "$APP_DIR" reset --hard "$TARGET_REF"

    # Rebuild and restart from source.
    echo "Rebuilding and restarting containers from source..."
    docker compose -f "$COMPOSE_FILE" down 2>/dev/null || true
    docker compose -f "$COMPOSE_FILE" up -d --build
    ;;
  registry)
    # Pull prebuilt image and start without local build.
    if [ -z "${WEB_IMAGE:-}" ]; then
      echo "ERROR: WEB_IMAGE must be set in $ENV_FILE when DEPLOY_MODE=registry." >&2
      exit 1
    fi

    echo "Pulling prebuilt image: $WEB_IMAGE"
    docker compose -f "$COMPOSE_FILE" pull web

    echo "Restarting containers from registry image..."
    docker compose -f "$COMPOSE_FILE" down 2>/dev/null || true
    docker compose -f "$COMPOSE_FILE" up -d
    ;;
  *)
    echo "ERROR: DEPLOY_MODE must be either 'git' or 'registry'." >&2
    exit 1
    ;;
esac

# Clean up dangling images
echo "Cleaning up old images..."
docker image prune -f

echo "$(date '+%Y-%m-%d %H:%M:%S') - Deployment complete."
