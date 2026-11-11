/**
 * Service Accounts for Cloud Native Development IDE
 */

variable "project_id" {
  type = string
}

variable "developers_group" {
  type    = string
  default = ""
}

variable "additional_impersonators" {
  type    = list(string)
  default = []
}

locals {
  impersonators = compact(concat(
    var.developers_group != "" ? ["group:${var.developers_group}"] : [],
    var.additional_impersonators
  ))
}

resource "google_service_account" "cnd_dev" {
  account_id   = "cnd-dev-sa"
  display_name = "CND-IDE Development Service Account"
  project      = var.project_id
}

resource "google_service_account" "cnd_cicd" {
  account_id   = "cnd-cicd-sa"
  display_name = "CND-IDE CI/CD Service Account"
  project      = var.project_id
}

resource "google_service_account" "cnd_obs" {
  account_id   = "cnd-obs-sa"
  display_name = "CND-IDE Observability Service Account"
  project      = var.project_id
}

resource "google_project_iam_member" "dev_roles" {
  for_each = toset([
    "roles/container.developer",
    "roles/run.developer",
    "roles/cloudfunctions.developer",
    "roles/aiplatform.user",
    "roles/bigquery.dataEditor",
    "roles/bigquery.jobUser",
    "roles/secretmanager.secretAccessor",
    "roles/logging.viewer",
    "roles/cloudtrace.user",
    "roles/artifactregistry.reader",
    "roles/storage.objectViewer",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.cnd_dev.email}"
}

resource "google_service_account_iam_member" "dev_token_creator" {
  for_each           = toset(local.impersonators)
  service_account_id = google_service_account.cnd_dev.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = each.value
}

output "service_accounts" {
  value = {
    dev  = google_service_account.cnd_dev.email
    cicd = google_service_account.cnd_cicd.email
    obs  = google_service_account.cnd_obs.email
  }
}
