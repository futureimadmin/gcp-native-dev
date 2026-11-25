variable "image" {
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
  description = "Placeholder image. Your pipeline deploys the real one; Terraform ignores later image changes."
}

variable "cloudrun_ingress" {
  type    = string
  default = "INGRESS_TRAFFIC_ALL"
}

resource "google_cloud_run_v2_service" "app" {
  name                = local.name
  location            = var.region
  ingress             = var.cloudrun_ingress
  deletion_protection = var.deletion_protection
  labels              = local.labels

  template {
    service_account = google_service_account.app.email

    # the service reaches private IPs (databases, caches) through its own subnet: no connector to run or pay for
    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"
      network_interfaces {
        network    = google_compute_network.vpc__S__.id
        subnetwork = google_compute_subnetwork.run__S__[0].id
      }
    }

    containers {
      image = var.image
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }
}
