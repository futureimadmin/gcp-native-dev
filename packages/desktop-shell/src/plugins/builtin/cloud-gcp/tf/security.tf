#@secrets Secret Manager
# The secret exists; its value is added by whoever owns it (never by Terraform, so it never lands in the state file).
resource "google_secret_manager_secret" "config" {
  secret_id = "${local.name}-config"
  labels    = local.labels

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_iam_member" "app_reads" {
  secret_id = google_secret_manager_secret.config.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app.email}"
}

#@kms Cloud KMS
resource "google_kms_key_ring" "ring" {
  name     = "${local.name}-ring"
  location = var.region
}

resource "google_kms_crypto_key" "key" {
  name            = "${local.name}-key"
  key_ring        = google_kms_key_ring.ring.id
  rotation_period = "7776000s" # 90 days
  labels          = local.labels

  lifecycle {
    prevent_destroy = false
  }
}

resource "google_kms_crypto_key_iam_member" "app_uses" {
  crypto_key_id = google_kms_crypto_key.key.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.app.email}"
}

#@edge Edge: static IP and Cloud Armor (WAF)
resource "google_compute_global_address" "edge" {
  name = "${local.name}-edge-ip"
}

resource "google_compute_security_policy" "waf" {
  name        = "${local.name}-waf"
  description = "OWASP rules in front of the public entry point"

  dynamic "rule" {
    for_each = {
      sqli = { rule = "sqli-v33-stable", priority = 1000 }
      xss  = { rule = "xss-v33-stable", priority = 1001 }
      lfi  = { rule = "lfi-v33-stable", priority = 1002 }
      rce  = { rule = "rce-v33-stable", priority = 1003 }
    }
    content {
      action   = "deny(403)"
      priority = rule.value.priority
      match {
        expr {
          expression = "evaluatePreconfiguredWaf('${rule.value.rule}')"
        }
      }
      description = "OWASP ${rule.key}"
    }
  }

  rule {
    action   = "allow"
    priority = 2147483647
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    description = "default rule"
  }
}
