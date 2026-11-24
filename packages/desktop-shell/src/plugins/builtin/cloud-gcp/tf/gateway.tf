#@octopus Octopus API Gateway: its Google identity (the gateway itself comes from Google Cloud Marketplace)
# Octopus runs on GKE behind the global HTTPS load balancer (static IP and Cloud Armor policy are created above), keeps its
# configuration in Firestore and its cache and rate limits in Memorystore. Install it into the cluster from Google Cloud Marketplace,
# then point it at the identity below. Namespace and Kubernetes service account names follow the Marketplace deployment.
variable "octopus_namespace" {
  type    = string
  default = "octopus"
}

variable "octopus_k8s_service_account" {
  type    = string
  default = "octopus"
}

resource "google_service_account" "octopus" {
  account_id   = substr("${local.name}-octopus", 0, 30)
  display_name = "${local.name} Octopus API Gateway"
}

# Firestore for configuration and audit data; logs and metrics. Nothing else.
resource "google_project_iam_member" "octopus" {
  for_each = toset([
    "roles/datastore.user",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.octopus.email}"
}

resource "google_service_account_iam_member" "octopus_workload_identity" {
  service_account_id = google_service_account.octopus.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[${var.octopus_namespace}/${var.octopus_k8s_service_account}]"
  depends_on         = [google_container_cluster.gke]
}

#@apigee Apigee X (Google-managed API management)
# Apigee takes a /22 for its runtime out of the private service range of the VPC and takes 30 minutes or more
# to create. Billing type EVALUATION is for a trial; PAYG or SUBSCRIPTION for real use (check Apigee pricing first).
variable "apigee_analytics_region" {
  type    = string
  default = "us-central1"
}

variable "apigee_billing_type" {
  type    = string
  default = "EVALUATION"
}

variable "apigee_hostname" {
  type        = string
  default     = "api.example.com"
  description = "Host name of the environment group (a domain you own)"
}

resource "google_apigee_organization" "org" {
  project_id         = var.project_id
  analytics_region   = var.apigee_analytics_region
  authorized_network = google_compute_network.vpc.id
  billing_type       = var.apigee_billing_type

  depends_on = [google_service_networking_connection.psa]
}

resource "google_apigee_instance" "runtime" {
  name                 = "${local.name}-apigee"
  location             = var.region
  org_id               = google_apigee_organization.org.id
  peering_cidr_range   = "SLASH_22"
  consumer_accept_list = [var.project_id]
}

resource "google_apigee_environment" "env" {
  org_id = google_apigee_organization.org.id
  name   = var.env
}

resource "google_apigee_envgroup" "group" {
  org_id    = google_apigee_organization.org.id
  name      = "${local.name}-group"
  hostnames = [var.apigee_hostname]
}

resource "google_apigee_envgroup_attachment" "attach" {
  envgroup_id = google_apigee_envgroup.group.id
  environment = google_apigee_environment.env.name
}

resource "google_apigee_instance_attachment" "attach" {
  instance_id = google_apigee_instance.runtime.id
  environment = google_apigee_environment.env.name
}
