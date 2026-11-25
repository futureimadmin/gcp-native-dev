# The network of one VPC (the generator writes this block once per VPC: __S__ is a suffix, __N__ a name suffix, __P__ a variable prefix).
variable "__P__cidr_env" {
  type        = string
  description = "The /16 of this environment's VPC (each environment has its own, so they can be peered or connected later)"
}

variable "__P__cidr_gke" {
  type    = string
  default = ""
}

variable "__P__cidr_run" {
  type    = string
  default = ""
}

variable "__P__cidr_data" {
  type    = string
  default = ""
}

variable "__P__cidr_gke_pods" {
  type    = string
  default = ""
}

variable "__P__cidr_gke_services" {
  type    = string
  default = ""
}

variable "__P__cidr_gke_master" {
  type    = string
  default = ""
}

variable "__P__psa_address" {
  type    = string
  default = ""
}

variable "__P__psa_prefix_length" {
  type    = number
  default = 20
}

variable "__P__enable_nat" {
  type    = bool
  default = true
}

variable "__P__enable_psa" {
  type    = bool
  default = false
}

variable "__P__enable_gke" {
  type    = bool
  default = false
}

variable "__P__enable_run" {
  type    = bool
  default = false
}

variable "__P__enable_data" {
  type    = bool
  default = false
}

# one more private subnet per extra application service (name => cidr)
variable "__P__service_subnets" {
  type    = map(string)
  default = {}
}

variable "__P__enable_lb_edge" {
  type    = bool
  default = false
}

# ---------------------------------------------------------------- network
resource "google_compute_network" "vpc__S__" {
  name                    = "${local.name}__N__-vpc"
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"
}

# Every tier has its own private subnet: application platforms (GKE, Cloud Run, extra services) and the data tier never share one.
# No subnet hands out public addresses; reaching Google APIs uses Private Google Access.
resource "google_compute_subnetwork" "gke__S__" {
  count                    = var.__P__enable_gke ? 1 : 0
  name                     = "${local.name}__N__-gke"
  region                   = var.region
  network                  = google_compute_network.vpc__S__.id
  ip_cidr_range            = var.__P__cidr_gke
  private_ip_google_access = true

  secondary_ip_range {
    range_name    = "${local.name}__N__-pods"
    ip_cidr_range = var.__P__cidr_gke_pods
  }

  secondary_ip_range {
    range_name    = "${local.name}__N__-services"
    ip_cidr_range = var.__P__cidr_gke_services
  }

  log_config {
    aggregation_interval = "INTERVAL_10_MIN"
    flow_sampling        = 0.5
    metadata             = "INCLUDE_ALL_METADATA"
  }
}

resource "google_compute_subnetwork" "run__S__" {
  count                    = var.__P__enable_run ? 1 : 0
  name                     = "${local.name}__N__-run"
  region                   = var.region
  network                  = google_compute_network.vpc__S__.id
  ip_cidr_range            = var.__P__cidr_run
  private_ip_google_access = true

  log_config {
    aggregation_interval = "INTERVAL_10_MIN"
    flow_sampling        = 0.5
    metadata             = "INCLUDE_ALL_METADATA"
  }
}

resource "google_compute_subnetwork" "service__S__" {
  for_each                 = var.__P__service_subnets
  name                     = "${local.name}__N__-${each.key}"
  region                   = var.region
  network                  = google_compute_network.vpc__S__.id
  ip_cidr_range            = each.value
  private_ip_google_access = true

  log_config {
    aggregation_interval = "INTERVAL_10_MIN"
    flow_sampling        = 0.5
    metadata             = "INCLUDE_ALL_METADATA"
  }
}

# the database's own subnet: it holds the private endpoint of the database and nothing else
resource "google_compute_subnetwork" "data__S__" {
  count                    = var.__P__enable_data ? 1 : 0
  name                     = "${local.name}__N__-data"
  region                   = var.region
  network                  = google_compute_network.vpc__S__.id
  ip_cidr_range            = var.__P__cidr_data
  private_ip_google_access = true

  log_config {
    aggregation_interval = "INTERVAL_10_MIN"
    flow_sampling        = 0.5
    metadata             = "INCLUDE_ALL_METADATA"
  }
}

resource "google_compute_router" "router__S__" {
  count   = var.__P__enable_nat ? 1 : 0
  name    = "${local.name}__N__-router"
  region  = var.region
  network = google_compute_network.vpc__S__.id
}

resource "google_compute_router_nat" "nat__S__" {
  count                              = var.__P__enable_nat ? 1 : 0
  name                               = "${local.name}__N__-nat"
  router                             = google_compute_router.router__S__[0].name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}

# private range for Google-managed services that live in their own network (Memorystore, Apigee)
resource "google_compute_global_address" "psa__S__" {
  count         = var.__P__enable_psa ? 1 : 0
  name          = "${local.name}__N__-psa"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  address       = var.__P__psa_address
  prefix_length = var.__P__psa_prefix_length
  network       = google_compute_network.vpc__S__.id
}

resource "google_service_networking_connection" "psa__S__" {
  count                   = var.__P__enable_psa ? 1 : 0
  network                 = google_compute_network.vpc__S__.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.psa__S__[0].name]
}

resource "google_compute_firewall" "allow_internal__S__" {
  name      = "${local.name}__N__-allow-internal"
  network   = google_compute_network.vpc__S__.id
  direction = "INGRESS"
  priority  = 1000

  source_ranges = [var.__P__cidr_env]

  allow {
    protocol = "tcp"
  }
  allow {
    protocol = "udp"
  }
  allow {
    protocol = "icmp"
  }
}

resource "google_compute_firewall" "allow_health_checks__S__" {
  count     = var.__P__enable_gke || var.__P__enable_lb_edge ? 1 : 0
  name      = "${local.name}__N__-allow-health-checks"
  network   = google_compute_network.vpc__S__.id
  direction = "INGRESS"
  priority  = 1000

  # Google's health-check and load-balancer ranges
  source_ranges = ["130.211.0.0/22", "35.191.0.0/16"]

  allow {
    protocol = "tcp"
  }
}
