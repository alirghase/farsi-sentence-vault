terraform {
  required_version = ">= 1.6"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  service_name = "farsi-brain"
  repo_name    = "farsi-vault"
  # Until an image is pushed, deploy a placeholder so `terraform apply` succeeds
  # on a clean project and the infrastructure exists to push into.
  image = var.image != "" ? var.image : "us-docker.pkg.dev/cloudrun/container/hello"
}

# --- APIs ------------------------------------------------------------------

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "firestore.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudscheduler.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "billingbudgets.googleapis.com",
  ])
  service            = each.key
  disable_on_destroy = false
}

# --- Container registry ----------------------------------------------------

resource "google_artifact_registry_repository" "repo" {
  location      = var.region
  repository_id = local.repo_name
  format        = "DOCKER"
  description   = "Farsi Vault backend images"

  # Keep only recent images; untagged layers accrue storage cost otherwise.
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 3
    }
  }

  depends_on = [google_project_service.apis]
}

# --- Firestore -------------------------------------------------------------

resource "google_firestore_database" "db" {
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  # Guard against an accidental `terraform destroy` taking the practice history
  # with it. Delete deliberately if you really mean to.
  delete_protection_state = "DELETE_PROTECTION_ENABLED"
  deletion_policy         = "ABANDON"

  depends_on = [google_project_service.apis]
}

# --- Secrets ---------------------------------------------------------------

resource "google_secret_manager_secret" "gemini_key" {
  secret_id = "farsi-gemini-api-key"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "gemini_key" {
  secret      = google_secret_manager_secret.gemini_key.id
  secret_data = var.gemini_api_key
}

resource "google_secret_manager_secret" "api_token" {
  secret_id = "farsi-api-token"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "api_token" {
  secret      = google_secret_manager_secret.api_token.id
  secret_data = var.api_token
}

# --- Service identity ------------------------------------------------------

resource "google_service_account" "run" {
  account_id   = "farsi-brain-run"
  display_name = "Farsi Vault Cloud Run service"
}

resource "google_project_iam_member" "run_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.run.email}"
}

resource "google_secret_manager_secret_iam_member" "run_gemini_key" {
  secret_id = google_secret_manager_secret.gemini_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.run.email}"
}

resource "google_secret_manager_secret_iam_member" "run_api_token" {
  secret_id = google_secret_manager_secret.api_token.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.run.email}"
}

# --- Cloud Run -------------------------------------------------------------

resource "google_cloud_run_v2_service" "brain" {
  name     = local.service_name
  location = var.region

  template {
    service_account                  = google_service_account.run.email
    timeout                          = "900s"
    max_instance_request_concurrency = 8

    # Cheapest posture: no idle instances, no CPU billed between requests.
    scaling {
      min_instance_count = 0
      # Hard ceiling. One learner never needs more than one instance; this caps
      # the blast radius of a retry storm or a leaked token.
      max_instance_count = 2
    }

    containers {
      image = local.image

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        # Throttle CPU between requests — the difference between scale-to-zero
        # being free and being billed continuously.
        cpu_idle          = true
        startup_cpu_boost = true
      }

      env {
        name  = "FARSI_UID"
        value = "me"
      }
      env {
        name  = "ALLOWED_ORIGINS"
        value = var.allowed_origins
      }
      env {
        name = "GEMINI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.gemini_key.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "FARSI_API_TOKEN"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.api_token.secret_id
            version = "latest"
          }
        }
      }

      startup_probe {
        http_get {
          path = "/healthz"
        }
        initial_delay_seconds = 5
        period_seconds        = 5
        failure_threshold     = 6
      }
    }
  }

  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_version.gemini_key,
    google_secret_manager_secret_version.api_token,
  ]

  lifecycle {
    # Deploys push new images out of band; do not let Terraform revert them.
    ignore_changes = [template[0].containers[0].image]
  }
}

# The iPhone cannot easily obtain a Google identity token on a free Apple
# account, so the service is reachable publicly and EVERY endpoint except
# /healthz is gated on the bearer token in application code.
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.brain.name
  location = google_cloud_run_v2_service.brain.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# --- Nightly pre-generation ------------------------------------------------

resource "google_service_account" "scheduler" {
  account_id   = "farsi-brain-scheduler"
  display_name = "Farsi Vault nightly generation"
}

resource "google_cloud_scheduler_job" "nightly" {
  name        = "farsi-nightly-generate"
  description = "Pre-generate tomorrow's sentence batch before the morning commute"
  schedule    = var.schedule_cron
  time_zone   = "Europe/London"
  region      = var.region

  # One retry. Generation is idempotent per day (guarded by batch_exists), so a
  # retry cannot double-charge, but there is no value in hammering it either.
  retry_config {
    retry_count = 1
  }

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.brain.uri}/internal/generate?count=${var.daily_batch_size}"

    headers = {
      "Authorization" = "Bearer ${var.api_token}"
      "Content-Type"  = "application/json"
    }

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = google_cloud_run_v2_service.brain.uri
    }
  }

  depends_on = [google_project_service.apis]
}

# --- Cost guardrail --------------------------------------------------------

resource "google_monitoring_notification_channel" "email" {
  count        = var.alert_email != "" ? 1 : 0
  display_name = "Farsi Vault budget alert"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }
}

# This design should cost nothing. The budget exists to catch the case where
# that assumption is wrong — a misconfiguration, a leaked token, a retry storm.
resource "google_billing_budget" "guard" {
  count           = var.billing_account != "" ? 1 : 0
  billing_account = var.billing_account
  display_name    = "Farsi Vault monthly guard"

  budget_filter {
    projects = ["projects/${data.google_project.current.number}"]
  }

  amount {
    specified_amount {
      currency_code = "GBP"
      units         = tostring(var.budget_amount_gbp)
    }
  }

  dynamic "threshold_rules" {
    for_each = [0.5, 0.9, 1.0]
    content {
      threshold_percent = threshold_rules.value
    }
  }

  dynamic "all_updates_rule" {
    for_each = var.alert_email != "" ? [1] : []
    content {
      monitoring_notification_channels = [google_monitoring_notification_channel.email[0].id]
      disable_default_iam_recipients   = false
    }
  }

  depends_on = [google_project_service.apis]
}

data "google_project" "current" {
  project_id = var.project_id
}
