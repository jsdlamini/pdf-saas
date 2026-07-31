#!/bin/bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$APP_DIR/.env"

MODE="all"
COMMIT_MESSAGE=""
IMAGE_TAG=""
PUSH_LATEST="false"
DRY_RUN="false"

usage() {
  cat <<'EOF'
Usage: ./release.sh [options]

Options:
  --mode <all|git|registry>    Release mode (default: all)
  --commit "message"           Commit message. If set, script runs git add -A + commit.
  --tag <tag>                  Image tag override. Default: short git SHA.
  --latest                     Also push :latest tag for the same image.
  --dry-run                    Print actions without executing write/push operations.
  -h, --help                   Show this help.

Environment (.env):
  WEB_IMAGE_REPO               Required for registry/all mode. Example: ghcr.io/acme/pdf-saas-web
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY  Required to build image.

Examples:
  ./release.sh --mode git --commit "feat: update deploy flow"
  ./release.sh --mode registry --tag v1.4.2
  ./release.sh --mode all --commit "chore: release" --latest
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --commit)
      COMMIT_MESSAGE="${2:-}"
      shift 2
      ;;
    --tag)
      IMAGE_TAG="${2:-}"
      shift 2
      ;;
    --latest)
      PUSH_LATEST="true"
      shift
      ;;
    --dry-run)
      DRY_RUN="true"
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

if [[ "$MODE" != "all" && "$MODE" != "git" && "$MODE" != "registry" ]]; then
  echo "ERROR: --mode must be one of: all, git, registry" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Copy env.compose.example to .env first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

run_cmd() {
  local cmd="$1"
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[dry-run] $cmd"
  else
    eval "$cmd"
  fi
}

echo "=== PDF SaaS Release ==="
echo "Mode: $MODE"

git -C "$APP_DIR" rev-parse --is-inside-work-tree >/dev/null

if [[ -n "$COMMIT_MESSAGE" ]]; then
  echo "Staging and committing changes..."
  run_cmd "git -C \"$APP_DIR\" add -A"

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[dry-run] git -C \"$APP_DIR\" commit -m \"$COMMIT_MESSAGE\""
  else
    if git -C "$APP_DIR" diff --cached --quiet; then
      echo "No staged changes to commit. Continuing."
    else
      git -C "$APP_DIR" commit -m "$COMMIT_MESSAGE"
    fi
  fi
fi

CURRENT_SHA="$(git -C "$APP_DIR" rev-parse --short HEAD)"
CURRENT_BRANCH="$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)"

if [[ "$MODE" == "all" || "$MODE" == "git" ]]; then
  echo "Pushing git branch '$CURRENT_BRANCH'..."
  run_cmd "git -C \"$APP_DIR\" push origin \"$CURRENT_BRANCH\""
fi

if [[ "$MODE" == "all" || "$MODE" == "registry" ]]; then
  if [[ -z "${WEB_IMAGE_REPO:-}" ]]; then
    echo "ERROR: WEB_IMAGE_REPO must be set in $ENV_FILE for registry/all mode." >&2
    exit 1
  fi

  if [[ -z "${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:-}" ]]; then
    echo "ERROR: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must be set in $ENV_FILE for image build." >&2
    exit 1
  fi

  FINAL_TAG="${IMAGE_TAG:-$CURRENT_SHA}"
  IMAGE_REF="$WEB_IMAGE_REPO:$FINAL_TAG"

  echo "Building image: $IMAGE_REF"
  run_cmd "docker build -t \"$IMAGE_REF\" --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=\"$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY\" \"$APP_DIR\""

  echo "Pushing image: $IMAGE_REF"
  run_cmd "docker push \"$IMAGE_REF\""

  if [[ "$PUSH_LATEST" == "true" ]]; then
    LATEST_REF="$WEB_IMAGE_REPO:latest"
    echo "Tagging and pushing: $LATEST_REF"
    run_cmd "docker tag \"$IMAGE_REF\" \"$LATEST_REF\""
    run_cmd "docker push \"$LATEST_REF\""
  fi

  echo
  echo "Set these on the VPS for registry deploy:"
  echo "DEPLOY_MODE=registry"
  echo "WEB_IMAGE=$IMAGE_REF"
fi

echo
if [[ "$MODE" == "all" || "$MODE" == "git" ]]; then
  echo "Set this on the VPS for git deploy pinning (optional):"
  echo "DEPLOY_GIT_REF=$CURRENT_SHA"
fi

echo "Release workflow complete."
