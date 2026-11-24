output "network" {
  value       = google_compute_network.vpc.name
  description = "The VPC of this environment"
}

output "app_service_account" {
  value       = google_service_account.app.email
  description = "Identity the application runs as"
}

output "subnets" {
  value = {
    app  = google_compute_subnetwork.app.ip_cidr_range
    data = google_compute_subnetwork.data.ip_cidr_range
  }
}
