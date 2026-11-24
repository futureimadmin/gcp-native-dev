# GKE Autopilot: Google manages the nodes. Private nodes, workload identity, and nodes that run as a minimal service account.
resource "google_service_account" "gke_nodes" {
  account_id   = substr("${local.name}-nodes", 0, 30)
  display_name = "${local.name} GKE nodes"
}

resource "google_project_iam_member" "gke_nodes" {
  for_each = toset([
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/monitoring.viewer",
    "roles/stackdriver.resourceMetadata.writer",
    "roles/artifactregistry.reader",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.gke_nodes.email}"
}

resource "google_container_cluster" "gke" {
  name                = "${local.name}-gke"
  location            = var.region
  enable_autopilot    = true
  network             = google_compute_network.vpc.id
  subnetwork          = google_compute_subnetwork.app.id
  deletion_protection = var.deletion_protection
  resource_labels     = local.labels

  ip_allocation_policy {
    cluster_secondary_range_name  = "${local.name}-pods"
    services_secondary_range_name = "${local.name}-services"
  }

  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = var.cidr_gke_master
  }

  cluster_autoscaling {
    auto_provisioning_defaults {
      service_account = google_service_account.gke_nodes.email
      oauth_scopes    = ["https://www.googleapis.com/auth/cloud-platform"]
    }
  }

  depends_on = [google_project_iam_member.gke_nodes]
}

# the application's Google identity is used inside the cluster through workload identity (no keys)
variable "k8s_namespace" {
  type    = string
  default = "default"
}

variable "k8s_service_account" {
  type    = string
  default = "app"
}

resource "google_service_account_iam_member" "app_workload_identity" {
  service_account_id = google_service_account.app.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[${var.k8s_namespace}/${var.k8s_service_account}]"
  depends_on         = [google_container_cluster.gke]
}
