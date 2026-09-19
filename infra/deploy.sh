#!/usr/bin/env bash
# Build the backend image and roll it out to Cloud Run.
#
#   bash infra/deploy.sh <project-id> [region]
#
# Uses Cloud Build so nothing needs Docker locally. First run takes a few
# minutes; later runs reuse cached layers.
set -euo pipefail

PROJECT="${1:?usage: deploy.sh <project-id> [region]}"
REGION="${2:-europe-west2}"
REPO="farsi-vault"
SERVICE="farsi-brain"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/${SERVICE}"
TAG="$(date +%Y%m%d-%H%M%S)"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Building ${IMAGE}:${TAG}"
gcloud builds submit "${ROOT}" \
  --project "${PROJECT}" \
  --config - <<YAML
steps:
  - name: gcr.io/cloud-builders/docker
    args: ["build", "-f", "backend/Dockerfile", "-t", "${IMAGE}:${TAG}", "-t", "${IMAGE}:latest", "."]
images:
  - "${IMAGE}:${TAG}"
  - "${IMAGE}:latest"
options:
  logging: CLOUD_LOGGING_ONLY
YAML

echo "==> Deploying to Cloud Run"
gcloud run deploy "${SERVICE}" \
  --project "${PROJECT}" \
  --region "${REGION}" \
  --image "${IMAGE}:${TAG}" \
  --quiet

URL="$(gcloud run services describe "${SERVICE}" \
  --project "${PROJECT}" --region "${REGION}" --format='value(status.url)')"

echo "==> Deployed: ${URL}"
echo "==> Health check:"
curl -fsS "${URL}/healthz" && echo
echo
echo "Put this URL in the app's Settings screen, with your api_token."
