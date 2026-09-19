# Copy to terraform.tfvars (gitignored) and fill in.
project_id      = "farsi-vault-123456"
region          = "europe-west2"
gemini_api_key  = "AIza..."              # aistudio.google.com/apikey
api_token       = "CHANGE-ME"            # openssl rand -base64 32
billing_account = "01ABCD-234567-89EFGH" # gcloud billing accounts list
alert_email     = "you@example.com"

# The PWA's origin — scheme and host only, no path or trailing slash.
allowed_origins = "https://alirghase.github.io"
