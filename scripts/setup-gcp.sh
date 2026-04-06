#!/usr/bin/env bash
# =============================================================================
# setup-gcp.sh — One-time GCP + Firebase project bootstrap
#
# Run this script ONCE from your local machine (with gcloud + firebase-tools
# already installed and authenticated) to provision every resource the
# GitHub Actions workflows need.
#
# Usage:
#   chmod +x scripts/setup-gcp.sh
#   ./scripts/setup-gcp.sh
#
# Prerequisites:
#   brew install google-cloud-sdk firebase-cli   (macOS)
#   gcloud auth login
#   gcloud auth application-default login
#   firebase login
# =============================================================================
set -euo pipefail

# ─── Configuration — edit these before running ───────────────────────────────
GCP_PROJECT_ID="YOUR_GCP_PROJECT_ID"      # e.g. my-project-123
GCP_REGION="us-central1"                  # Cloud Run & Artifact Registry region
AR_REPO="misfitai"                        # Artifact Registry repository name
CLOUD_RUN_SERVICE="misfitai-backend"      # Cloud Run service name
SA_NAME="github-actions-deploy"           # Service account for GitHub Actions
GITHUB_ORG="YOUR_GITHUB_USERNAME_OR_ORG"  # e.g. acme-corp
GITHUB_REPO="YOUR_GITHUB_REPO_NAME"       # e.g. AI_Wardrobe_Planner (exact, case-sensitive)
WIF_POOL="github-pool"                    # Workload Identity Pool name
WIF_PROVIDER="github-provider"            # Workload Identity Provider name
FIREBASE_PROJECT_ID="YOUR_FIREBASE_PROJECT_ID" # Usually same as GCP_PROJECT_ID
# Firebase Hosting service account — created by `firebase init hosting:github`
# or via Firebase Console → Project Settings → Service accounts.
# Leave blank on first run; fill in and re-run after Firebase is initialised.
FIREBASE_SA_EMAIL=""  # e.g. github-action-123456@my-project.iam.gserviceaccount.com
# ─────────────────────────────────────────────────────────────────────────────

# Guard: exit immediately if any placeholder value was not replaced.
_PLACEHOLDERS=("YOUR_GCP_PROJECT_ID" "YOUR_GITHUB_USERNAME_OR_ORG" "YOUR_GITHUB_REPO_NAME" "YOUR_FIREBASE_PROJECT_ID")
for _P in "${_PLACEHOLDERS[@]}"; do
  if [[ "$GCP_PROJECT_ID" == "$_P" || "$GITHUB_ORG" == "$_P" || \
        "$GITHUB_REPO" == "$_P" || "$FIREBASE_PROJECT_ID" == "$_P" ]]; then
    echo "ERROR: Replace all placeholder values in the Configuration block before running this script." >&2
    echo "       Placeholder still present: $_P" >&2
    exit 1
  fi
done

SA_EMAIL="${SA_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
AR_HOST="${GCP_REGION}-docker.pkg.dev"
AR_IMAGE_BASE="${AR_HOST}/${GCP_PROJECT_ID}/${AR_REPO}/backend"

echo "========================================================"
echo " AI Wardrobe Planner — GCP Bootstrap"
echo " Project : $GCP_PROJECT_ID"
echo " Region  : $GCP_REGION"
echo "========================================================"

# ── 0. Set active project ─────────────────────────────────────────────────────
gcloud config set project "$GCP_PROJECT_ID"

# ── 1. Enable required GCP APIs ──────────────────────────────────────────────
echo ""
echo ">>> [1/7] Enabling required APIs…"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  cloudresourcemanager.googleapis.com \
  aiplatform.googleapis.com \
  firebase.googleapis.com

# ── 2. Create Artifact Registry Docker repository ─────────────────────────────
echo ""
echo ">>> [2/7] Creating Artifact Registry repository '${AR_REPO}'…"
if ! gcloud artifacts repositories describe "$AR_REPO" \
       --location="$GCP_REGION" --format="value(name)" 2>/dev/null; then
  gcloud artifacts repositories create "$AR_REPO" \
    --repository-format=docker \
    --location="$GCP_REGION" \
    --description="AI Wardrobe Planner Docker images"
  echo "    Created: ${AR_REPO}"
else
  echo "    Already exists — skipping."
fi

# ── 3. Create GitHub Actions service account ──────────────────────────────────
echo ""
echo ">>> [3/7] Creating service account '${SA_NAME}'…"
if ! gcloud iam service-accounts describe "$SA_EMAIL" 2>/dev/null; then
  gcloud iam service-accounts create "$SA_NAME" \
    --display-name="GitHub Actions — AI Wardrobe Planner deploy"
  echo "    Created: ${SA_EMAIL}"
else
  echo "    Already exists — skipping."
fi

# Grant the service account the minimum permissions it needs.
for ROLE in \
  "roles/run.developer" \
  "roles/artifactregistry.writer" \
  "roles/iam.serviceAccountUser" \
  "roles/secretmanager.secretAccessor"; do
  gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="$ROLE" \
    --quiet
done
echo "    IAM roles granted."

# Grant the Cloud Run runtime identity (default compute SA) the permissions it
# needs while serving requests — Vertex AI calls and Secret Manager access.
PROJECT_NUMBER=$(gcloud projects describe "$GCP_PROJECT_ID" --format="value(projectNumber)")
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
for RUNTIME_ROLE in \
  "roles/aiplatform.user" \
  "roles/secretmanager.secretAccessor"; do
  gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
    --member="serviceAccount:${COMPUTE_SA}" \
    --role="$RUNTIME_ROLE" \
    --quiet
done
echo "    Granted roles/aiplatform.user + roles/secretmanager.secretAccessor to Cloud Run runtime SA: ${COMPUTE_SA}"

# Grant the Firebase Hosting service account read access to Cloud Run so it can
# validate rewrite rules in firebase.json at deploy time (run.services.get).
# Firebase Hosting calls this API for every `firebase deploy` and channel deploy.
if [[ -n "$FIREBASE_SA_EMAIL" ]]; then
  gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
    --member="serviceAccount:${FIREBASE_SA_EMAIL}" \
    --role="roles/run.viewer" \
    --quiet
  echo "    Granted roles/run.viewer to Firebase SA: ${FIREBASE_SA_EMAIL}"
else
  echo ""
  echo "    ⚠  FIREBASE_SA_EMAIL is not set — skipping Firebase SA IAM binding."
  echo "    After running \`firebase init hosting:github\`, fill in FIREBASE_SA_EMAIL"
  echo "    at the top of this script and re-run, OR run this command manually:"
  echo ""
  echo "    gcloud projects add-iam-policy-binding ${GCP_PROJECT_ID} \\"
  echo "      --member=\"serviceAccount:YOUR_FIREBASE_SA_EMAIL\" \\"
  echo "      --role=\"roles/run.viewer\""
fi

# ── 4. Workload Identity Federation ───────────────────────────────────────────
echo ""
echo ">>> [4/7] Setting up Workload Identity Federation…"

# Create the pool if it does not already exist.
if ! gcloud iam workload-identity-pools describe "$WIF_POOL" \
       --location=global --format="value(name)" 2>/dev/null; then
  gcloud iam workload-identity-pools create "$WIF_POOL" \
    --location=global \
    --display-name="GitHub Actions Pool"
  echo "    Pool created: ${WIF_POOL}"
else
  echo "    Pool already exists — skipping creation."
fi

WIF_POOL_RESOURCE=$(gcloud iam workload-identity-pools describe "$WIF_POOL" \
  --location=global --format="value(name)")

# Create the GitHub OIDC provider inside the pool.
if ! gcloud iam workload-identity-pools providers describe "$WIF_PROVIDER" \
       --workload-identity-pool="$WIF_POOL" \
       --location=global --format="value(name)" 2>/dev/null; then
  gcloud iam workload-identity-pools providers create-oidc "$WIF_PROVIDER" \
    --workload-identity-pool="$WIF_POOL" \
    --location=global \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository" \
    --attribute-condition="attribute.repository==\"${GITHUB_ORG}/${GITHUB_REPO}\"" \
    --display-name="GitHub OIDC Provider"
  echo "    Provider created: ${WIF_PROVIDER}"
else
  echo "    Provider already exists — skipping creation."
fi

# Allow the GitHub repo to impersonate the service account.
WIF_PROVIDER_RESOURCE=$(gcloud iam workload-identity-pools providers describe "$WIF_PROVIDER" \
  --workload-identity-pool="$WIF_POOL" \
  --location=global --format="value(name)")

gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${WIF_POOL_RESOURCE}/attribute.repository/${GITHUB_ORG}/${GITHUB_REPO}" \
  --quiet

echo "    Workload Identity binding applied."

# ── 5. Secret Manager — create secret stubs ──────────────────────────────────
echo ""
echo ">>> [5/7] Creating Secret Manager secrets…"
echo "    NOTE: This creates EMPTY secret stubs."
echo "    After running this script, populate each secret with the"
echo "    actual value using: gcloud secrets versions add SECRET_NAME --data-file=-"

SECRETS=(
  "SUPABASE_URL"
  "SUPABASE_SERVICE_KEY"
  "SERPAPI_KEY"
  "HF_API_TOKEN"
  "ALLOWED_ORIGINS"
)

for SECRET in "${SECRETS[@]}"; do
  if ! gcloud secrets describe "$SECRET" 2>/dev/null; then
    gcloud secrets create "$SECRET" \
      --replication-policy=automatic \
      --labels=app=misfitai
    echo "    Created secret stub: ${SECRET}"
  else
    echo "    Secret already exists: ${SECRET} — skipping."
  fi
done

# ── 6. Populate secrets from local .env (optional) ────────────────────────────
echo ""
read -rp ">>> [6/7] Do you want to seed secrets from your local .env file? [y/N] " SEED_SECRETS
if [[ "$SEED_SECRETS" =~ ^[Yy]$ ]]; then
  ENV_FILE="${1:-.env}"
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "    .env not found at '${ENV_FILE}' — skipping auto-seed."
  else
    while IFS='=' read -r KEY VALUE; do
      # Skip comments and empty lines
      [[ "$KEY" =~ ^#.*$ || -z "$KEY" ]] && continue
      # Strip leading/trailing spaces and inline comments from VALUE
      VALUE=$(echo "$VALUE" | sed 's/[[:space:]]*#.*//' | xargs)
      [[ -z "$VALUE" ]] && continue
      # Only seed secrets that are in the SECRETS list
      for SECRET in "${SECRETS[@]}"; do
        # Normalize key (remove spaces around =)
        CLEAN_KEY=$(echo "$KEY" | xargs)
        if [[ "$CLEAN_KEY" == "$SECRET" ]]; then
          echo -n "$VALUE" | gcloud secrets versions add "$SECRET" --data-file=-
          echo "    Seeded: ${SECRET}"
        fi
      done
    done < "$ENV_FILE"
    # Seed ALLOWED_ORIGINS separately since it's not in .env
    echo -n "https://${FIREBASE_PROJECT_ID}.web.app" | \
      gcloud secrets versions add "ALLOWED_ORIGINS" --data-file=- 2>/dev/null || true
    echo "    Seeded: ALLOWED_ORIGINS → https://${FIREBASE_PROJECT_ID}.web.app"
  fi
fi

# ── 7. Print GitHub Secrets summary ───────────────────────────────────────────
echo ""
echo "========================================================"
echo ">>> [7/7] Add these as GitHub repository secrets:"
echo "    (Settings → Secrets and variables → Actions → New repository secret)"
echo ""
echo "  GCP_PROJECT_ID"
echo "    Value: ${GCP_PROJECT_ID}"
echo ""
echo "  GCP_WORKLOAD_IDENTITY_PROVIDER"
echo "    Value: ${WIF_PROVIDER_RESOURCE}"
echo ""
echo "  GCP_SERVICE_ACCOUNT"
echo "    Value: ${SA_EMAIL}"
echo ""
echo "  GCP_REGION"
echo "    Value: ${GCP_REGION}"
echo ""
echo "  AR_IMAGE"
echo "    Value: ${AR_IMAGE_BASE}"
echo ""
echo "  CLOUD_RUN_SERVICE"
echo "    Value: ${CLOUD_RUN_SERVICE}"
echo ""
echo "  FIREBASE_PROJECT_ID"
echo "    Value: ${FIREBASE_PROJECT_ID}"
echo ""
echo "  FIREBASE_SERVICE_ACCOUNT  (create this via Firebase Console → Project Settings → Service accounts)"
echo "    Value: <paste the JSON content of the Firebase service account key>"
echo ""
echo "========================================================"
echo "Bootstrap complete!"
