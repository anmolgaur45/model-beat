# Pipeline deployment

The Cloud Run Job `ainews-pipeline` is built and deployed automatically by
`.github/workflows/deploy-pipeline.yml` on every push to `main` that touches
`pipeline/`. Tests gate the deploy. Images are tagged with the commit SHA and
the job is pinned to that exact image.

The workflow authenticates to GCP with Workload Identity Federation (no
service-account key stored in GitHub). The setup below is a one-time task.

## Constants

```
PROJECT_ID=ai-news-calendar-493510
REGION=asia-south1
REPO=anmolgaur45/ai-news-calendar
POOL=github-pool
PROVIDER=github-provider
DEPLOYER=gh-deployer@ai-news-calendar-493510.iam.gserviceaccount.com
RUNTIME_SA=ainews-pipeline@ai-news-calendar-493510.iam.gserviceaccount.com
```

## One-time setup (run with an owner account)

```bash
PROJECT_ID=ai-news-calendar-493510
REGION=asia-south1
REPO=anmolgaur45/ai-news-calendar
POOL=github-pool
PROVIDER=github-provider
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
DEPLOYER="gh-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME_SA="ainews-pipeline@${PROJECT_ID}.iam.gserviceaccount.com"

# 1. APIs for keyless auth
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com \
  --project "$PROJECT_ID"

# 2. Deployer service account (CI identity)
gcloud iam service-accounts create gh-deployer \
  --display-name="GitHub Actions deployer" --project "$PROJECT_ID"

# 3. Roles: push images, deploy jobs, run jobs as the runtime SA
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${DEPLOYER}" --role="roles/artifactregistry.writer"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${DEPLOYER}" --role="roles/run.developer"
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="serviceAccount:${DEPLOYER}" --role="roles/iam.serviceAccountUser" \
  --project "$PROJECT_ID"

# 4. Workload Identity pool + provider, locked to this repo
gcloud iam workload-identity-pools create "$POOL" \
  --location=global --project "$PROJECT_ID" --display-name="GitHub"
gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
  --location=global --workload-identity-pool="$POOL" --project "$PROJECT_ID" \
  --display-name="GitHub OIDC" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='${REPO}'"

# 5. Let this repo impersonate the deployer SA
gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER" \
  --role=roles/iam.workloadIdentityUser --project "$PROJECT_ID" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${REPO}"

# 6. Print the values for the GitHub repo variables
echo "WIF_PROVIDER=projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"
echo "DEPLOYER_SA=${DEPLOYER}"
```

Then add the two printed values as GitHub repo **variables** (not secrets):

```bash
gh variable set WIF_PROVIDER --repo "$REPO" --body "projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"
gh variable set DEPLOYER_SA  --repo "$REPO" --body "$DEPLOYER"
```

The `deploy` job skips itself until both variables exist, so CI stays green
before setup.

## Cap image storage (run once)

Each deploy pushes a new image (~2-4 GB). This keeps only the 3 most recent and
deletes anything older than 30 days, holding Artifact Registry storage to ~$1/mo.

```bash
cat > /tmp/ar-cleanup.json <<'JSON'
[
  {"name": "keep-recent", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 3}},
  {"name": "delete-stale", "action": {"type": "Delete"}, "condition": {"tagState": "ANY", "olderThan": "2592000s"}}
]
JSON
gcloud artifacts repositories set-cleanup-policies ainews \
  --location="$REGION" --project "$PROJECT_ID" --policy=/tmp/ar-cleanup.json
```

## Manual deploy / rollback

- Trigger a deploy without a code change: Actions tab → **deploy-pipeline** → Run workflow.
- Roll back: re-run the workflow on an older commit, or point the job at a prior SHA:
  `gcloud run jobs update ainews-pipeline --region=asia-south1 --image=<IMAGE>:<OLD_SHA>`
