output "service_url" {
  description = "Base URL for the app's Settings screen."
  value       = google_cloud_run_v2_service.brain.uri
}

output "image_repo" {
  description = "Docker push target."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.repo.repository_id}"
}

output "firestore_console" {
  value = "https://console.cloud.google.com/firestore/databases/-default-/data?project=${var.project_id}"
}

output "next_steps" {
  value = <<-EOT
    1. Build and push the image:
         bash infra/deploy.sh ${var.project_id} ${var.region}
    2. Put these into the app's Settings screen:
         URL:   ${google_cloud_run_v2_service.brain.uri}
         Token: (the api_token you set in terraform.tfvars)
    3. Confirm the service is alive:
         curl ${google_cloud_run_v2_service.brain.uri}/healthz
  EOT
}
