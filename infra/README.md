# Infrastructure

Cloud Run service that holds the Gemini key, grades attempts, and pre-generates
tomorrow's sentences at 05:00 London time.

## Cost

Designed to sit inside GCP's always-free allowances:

| Resource | Free allowance | This app's use |
|---|---|---|
| Cloud Run | 2M requests, 180k vCPU-s/month | ~10 requests/day |
| Firestore | 50k reads, 20k writes/day | ~300 reads, ~200 writes/day |
| Cloud Scheduler | 3 jobs | 1 job |
| Artifact Registry | 0.5 GB | ~200 MB, pruned to 3 images |
| Secret Manager | 6 versions, 10k access/month | 2 secrets |

**The free tier still requires a billing account with a card.** Three guardrails
exist because "free" here means "free unless misconfigured":

1. `max_instance_count = 2` and `cpu_idle = true` — caps a retry storm.
2. Daily model-call caps in the service (`MAX_GENERATE_CALLS_PER_DAY`,
   `MAX_GRADE_CALLS_PER_DAY`), counted in Firestore and enforced before any
   Gemini call.
3. A billing budget with alerts at 50/90/100% of £2.

Gemini itself is billed separately and stays on the AI Studio free tier
(1,500 requests/day on Flash); this service uses roughly 10.

## First deploy

```bash
brew install terraform          # if not already present
gcloud auth application-default login
gcloud config set project YOUR_PROJECT_ID

cp infra/example.tfvars infra/terraform.tfvars
# Fill in project_id, gemini_api_key, api_token, billing_account, alert_email.
# Generate the token with: openssl rand -base64 32

cd infra
terraform init
terraform apply                 # creates everything with a placeholder image

cd ..
bash infra/deploy.sh YOUR_PROJECT_ID
```

`terraform apply` deploys a placeholder container first so the service exists to
push into; `deploy.sh` then replaces it. Terraform ignores later image changes
(`lifecycle.ignore_changes`) so deploys and infra do not fight.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/healthz` | none | liveness |
| POST | `/v1/sync` | bearer | app's single round trip |
| GET | `/v1/usage` | bearer | today's model-call counts |
| POST | `/internal/generate` | bearer | nightly batch (Cloud Scheduler) |

The service is invokable by `allUsers` because a sideloaded iPhone app on a free
Apple account cannot obtain a Google identity token. **Every endpoint except
`/healthz` is therefore gated on the bearer token in application code** — IAM is
not providing the protection here. Rotate the token by writing a new Secret
Manager version and redeploying.

## Teardown

```bash
cd infra && terraform destroy
```

Firestore has `delete_protection_state = "DELETE_PROTECTION_ENABLED"` and
`deletion_policy = "ABANDON"`, so your practice history survives a destroy.
Remove the database deliberately in the console if you really want it gone.
