/**
 * Enable required Google Cloud APIs for CND-IDE
 */

variable "project_id" {
  type = string
}

resource "google_project_service" "required_apis" {
  for_each = toset([
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
    "container.googleapis.com",
    "run.googleapis.com",
    "cloudfunctions.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "aiplatform.googleapis.com",
    "bigquery.googleapis.com",
    "secretmanager.googleapis.com",
    "logging.googleapis.com",
    "cloudtrace.googleapis.com",
    "monitoring.googleapis.com",
    "pubsub.googleapis.com",
    "sqladmin.googleapis.com",
    "storage.googleapis.com",
    "compute.googleapis.com",
  ])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
