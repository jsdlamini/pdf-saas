#!/bin/bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$APP_DIR/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Copy env.compose.example to .env first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

SSH_TARGET="${DEPLOY_SSH_TARGET:-}"
SSH_PORT="${DEPLOY_SSH_PORT:-22}"
SSH_IDENTITY="${DEPLOY_SSH_IDENTITY:-}"
REMOTE_APP_DIR="${DEPLOY_APP_DIR:-/var/www/pdf-saas}"
PUBLISH_FIRST="false"
IMAGE_REF=""
IMAGE_TAG=""
COMMIT_MESSAGE=""
COMMIT_ALL_MESSAGE=""

usage() {
  cat <<'EOF'
Usage: ./ship.sh [options]

Options:
  --target <user@host>         SSH target. Defaults to DEPLOY_SSH_TARGET from .env.
  --port <port>                SSH port (default: 22 or DEPLOY_SSH_PORT).
  --identity <path>            SSH private key path.
  --app-dir <path>             Remote app dir (default: /var/www/pdf-saas).
  --image <ref>                Full image ref to deploy.
  --tag <tag>                  Tag to combine with WEB_IMAGE_REPO from local .env.
  --commit "message"           Stage all changes, commit, and push before publish/deploy.
  --commit-all "message"       Same as --commit, but fails if there are no local changes.
  --publish                    Run local ./release.sh --mode registry before deploy.
  -h, --help                   Show this help.

Behavior:
  1) Optionally commits and pushes git changes.
  2) Optionally publishes image to registry.
  3) SSHes into VPS.
  4) Updates remote .env: DEPLOY_MODE=registry and WEB_IMAGE=<image>.
  5) Executes remote ./deploy.sh.

Examples:
  ./ship.sh --target johns@idealsoftwaresolutions --publish --tag main
  ./ship.sh --target johns@idealsoftwaresolutions --commit "chore: release" --publish
  ./ship.sh --target johns@idealsoftwaresolutions --commit-all "chore: release" --publish
  ./ship.sh --target johns@idealsoftwaresolutions --image ghcr.io/acme/pdf-saas-web:abc1234
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      SSH_TARGET="${2:-}"
      shift 2
      ;;
    --port)
      SSH_PORT="${2:-}"
      shift 2
      ;;
    --identity)
      SSH_IDENTITY="${2:-}"
      shift 2
      ;;
    --app-dir)
      REMOTE_APP_DIR="${2:-}"
      shift 2
      ;;
    --image)
      IMAGE_REF="${2:-}"
      shift 2
      ;;
    --tag)
      IMAGE_TAG="${2:-}"
      shift 2
      ;;
    --commit)
      COMMIT_MESSAGE="${2:-}"
      shift 2
      ;;
    --commit-all)
      COMMIT_ALL_MESSAGE="${2:-}"
      shift 2
      ;;
    --publish)
      PUBLISH_FIRST="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$SSH_TARGET" ]]; then
  echo "ERROR: SSH target is required. Use --target or set DEPLOY_SSH_TARGET in .env." >&2
  exit 1
fi

if [[ -n "$COMMIT_MESSAGE" && -n "$COMMIT_ALL_MESSAGE" ]]; then
  echo "ERROR: Use either --commit or --commit-all, not both." >&2
  exit 1
fi

if [[ -n "$COMMIT_ALL_MESSAGE" ]]; then
  if git -C "$APP_DIR" diff --quiet && git -C "$APP_DIR" diff --cached --quiet; then
    echo "ERROR: --commit-all requested, but there are no local changes to commit." >&2
    exit 1
  fi

  echo "Committing and pushing local changes via release.sh (strict mode)..."
  "$APP_DIR/release.sh" --mode git --commit "$COMMIT_ALL_MESSAGE"
fi

if [[ -n "$COMMIT_MESSAGE" ]]; then
  echo "Committing and pushing local changes via release.sh..."
  "$APP_DIR/release.sh" --mode git --commit "$COMMIT_MESSAGE"
fi

if [[ -n "$IMAGE_REF" && -n "$IMAGE_TAG" ]]; then
  echo "ERROR: Use either --image or --tag, not both." >&2
  exit 1
fi

if [[ -z "$IMAGE_REF" ]]; then
  if [[ -z "${WEB_IMAGE_REPO:-}" ]]; then
    echo "ERROR: WEB_IMAGE_REPO must be set in local .env when --image is not provided." >&2
    exit 1
  fi

  if [[ -z "$IMAGE_TAG" ]]; then
    IMAGE_TAG="$(git -C "$APP_DIR" rev-parse --short HEAD)"
  fi

  IMAGE_REF="$WEB_IMAGE_REPO:$IMAGE_TAG"
fi

if [[ "$PUBLISH_FIRST" == "true" ]]; then
  if [[ -n "${IMAGE_REF:-}" && -z "${IMAGE_TAG:-}" ]]; then
    echo "ERROR: --publish cannot be combined with --image." >&2
    echo "Use --tag (with WEB_IMAGE_REPO) for publish+deploy in one command." >&2
    exit 1
  fi

  if [[ -z "${IMAGE_TAG:-}" ]]; then
    IMAGE_TAG="$(git -C "$APP_DIR" rev-parse --short HEAD)"
    IMAGE_REF="$WEB_IMAGE_REPO:$IMAGE_TAG"
  fi

  echo "Publishing image first via release.sh..."
  "$APP_DIR/release.sh" --mode registry --tag "$IMAGE_TAG"
fi

SSH_ARGS=(-p "$SSH_PORT")
if [[ -n "$SSH_IDENTITY" ]]; then
  SSH_ARGS+=(-i "$SSH_IDENTITY")
fi

echo "Deploying image '$IMAGE_REF' to '$SSH_TARGET'..."
ssh "${SSH_ARGS[@]}" "$SSH_TARGET" bash -s -- "$REMOTE_APP_DIR" "$IMAGE_REF" <<'REMOTE_SCRIPT'
set -euo pipefail

APP_DIR="$1"
WEB_IMAGE_VALUE="$2"
ENV_FILE="$APP_DIR/.env"
DEPLOY_SCRIPT="$APP_DIR/deploy.sh"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found on remote host." >&2
  exit 1
fi

if [[ ! -x "$DEPLOY_SCRIPT" ]]; then
  chmod +x "$DEPLOY_SCRIPT"
fi

upsert_env_var() {
  local key="$1"
  local value="$2"
  local escaped

  escaped="${value//\\/\\\\}"
  escaped="${escaped//&/\\&}"
  escaped="${escaped//|/\\|}"

  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

upsert_env_var "DEPLOY_MODE" "registry"
upsert_env_var "WEB_IMAGE" "$WEB_IMAGE_VALUE"

cd "$APP_DIR"
./deploy.sh
REMOTE_SCRIPT

echo "Ship complete."
