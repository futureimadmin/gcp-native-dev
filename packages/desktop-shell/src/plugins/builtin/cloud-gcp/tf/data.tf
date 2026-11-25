#@cloudsql Cloud SQL (PostgreSQL), private IP only
variable "sql_tier" {
  type    = string
  default = "db-custom-1-3840"
}

resource "google_sql_database_instance" "db" {
  name                = "${local.name}-pg"
  region              = var.region
  database_version    = "POSTGRES_15"
  deletion_protection = var.deletion_protection

  settings {
    tier              = var.sql_tier
    availability_type = var.env == "prod" ? "REGIONAL" : "ZONAL"
    user_labels       = local.labels

    # no public address: the database is reached through a private endpoint in its own subnet (Private Service Connect)
    ip_configuration {
      ipv4_enabled = false
      psc_config {
        psc_enabled               = true
        allowed_consumer_projects = [var.project_id]
      }
    }

    # applications sign in as their service account (IAM database authentication): no passwords to store or rotate
    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
    }
  }
}

# the endpoint: an address inside the data subnet that forwards to the database
resource "google_compute_address" "db_endpoint" {
  name         = "${local.name}-db-ip"
  region       = var.region
  address_type = "INTERNAL"
  subnetwork   = google_compute_subnetwork.data__S__[0].id
}

resource "google_compute_forwarding_rule" "db_endpoint" {
  name                  = "${local.name}-db-endpoint"
  region                = var.region
  network               = google_compute_network.vpc__S__.id
  ip_address            = google_compute_address.db_endpoint.id
  load_balancing_scheme = ""
  target                = google_sql_database_instance.db.psc_service_attachment_link
}

output "database_private_ip" {
  value       = google_compute_address.db_endpoint.address
  description = "Connect to the database at this private address (inside the data subnet)"
}

resource "google_sql_database" "app" {
  name     = replace(var.app, "-", "_")
  instance = google_sql_database_instance.db.name
}

resource "google_sql_user" "app" {
  # a service account user is its e-mail without ".gserviceaccount.com"
  name     = trimsuffix(google_service_account.app.email, ".gserviceaccount.com")
  instance = google_sql_database_instance.db.name
  type     = "CLOUD_IAM_SERVICE_ACCOUNT"
}

resource "google_project_iam_member" "app_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.app.email}"
}

resource "google_project_iam_member" "app_sql_user" {
  project = var.project_id
  role    = "roles/cloudsql.instanceUser"
  member  = "serviceAccount:${google_service_account.app.email}"
}

#@redis Memorystore for Redis
resource "google_redis_instance" "cache" {
  name               = "${local.name}-redis"
  region             = var.region
  tier               = var.env == "prod" ? "STANDARD_HA" : "BASIC"
  memory_size_gb     = 1
  redis_version      = "REDIS_7_0"
  authorized_network = google_compute_network.vpc__S__.id
  connect_mode       = "PRIVATE_SERVICE_ACCESS"
  auth_enabled       = true
  labels             = local.labels

  depends_on = [google_service_networking_connection.psa__S__]
}

#@firestore Firestore (native mode)
resource "google_firestore_database" "default" {
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"
}

resource "google_project_iam_member" "app_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.app.email}"
}

#@storage Cloud Storage bucket
resource "google_storage_bucket" "data" {
  name                        = "${var.project_id}-${var.app}-data"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = !var.deletion_protection
  labels                      = local.labels

  versioning {
    enabled = true
  }
}

# only this bucket, only objects: not storage.admin on the project
resource "google_storage_bucket_iam_member" "app_objects" {
  bucket = google_storage_bucket.data.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.app.email}"
}

#@bigquery BigQuery dataset
resource "google_bigquery_dataset" "analytics" {
  dataset_id                 = replace("${var.app}_${var.env}", "-", "_")
  location                   = var.region
  delete_contents_on_destroy = !var.deletion_protection
  labels                     = local.labels
}

resource "google_bigquery_dataset_iam_member" "app_editor" {
  dataset_id = google_bigquery_dataset.analytics.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${google_service_account.app.email}"
}

resource "google_project_iam_member" "app_bq_jobs" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.app.email}"
}
