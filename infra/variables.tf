variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "region" {
  description = "Region for Cloud Run, Artifact Registry, and Scheduler."
  type        = string
  default     = "europe-west2" # London — closest to the user
}

variable "gemini_api_key" {
  description = "Gemini API key from aistudio.google.com/apikey. Stored in Secret Manager, never in the image."
  type        = string
  sensitive   = true
}

variable "api_token" {
  description = "Shared bearer token the iPhone app presents. Generate with: openssl rand -base64 32"
  type        = string
  sensitive   = true
}

variable "billing_account" {
  description = "Billing account ID for the budget alert. Leave empty to skip the budget (NOT recommended)."
  type        = string
  default     = ""
}

variable "budget_amount_gbp" {
  description = "Monthly budget in GBP. Alerts fire at 50/90/100 percent. This design should cost 0."
  type        = number
  default     = 2
}

variable "alert_email" {
  description = "Email for budget alerts. Leave empty to rely on billing-account admins."
  type        = string
  default     = ""
}

variable "daily_batch_size" {
  description = "Sentences pre-generated each night."
  type        = number
  default     = 100
}

variable "schedule_cron" {
  description = "When to pre-generate. Default 05:00 London, so the batch is ready before the commute."
  type        = string
  default     = "0 5 * * *"
}

variable "image" {
  description = "Container image. Set after the first push; see infra/README.md."
  type        = string
  default     = ""
}

variable "allowed_origins" {
  description = "Comma-separated origins allowed to call the API from a browser (the PWA's URL)."
  type        = string
  default     = "http://localhost:8000"
}
