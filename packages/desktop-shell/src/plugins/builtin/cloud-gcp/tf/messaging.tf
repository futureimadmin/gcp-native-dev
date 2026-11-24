#@pubsub Pub/Sub
resource "google_pubsub_topic" "events" {
  name   = "${local.name}-events"
  labels = local.labels
}

resource "google_pubsub_topic" "dead_letter" {
  name   = "${local.name}-events-dead-letter"
  labels = local.labels
}

resource "google_pubsub_subscription" "events" {
  name                 = "${local.name}-events-sub"
  topic                = google_pubsub_topic.events.id
  ack_deadline_seconds = 30
  labels               = local.labels

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dead_letter.id
    max_delivery_attempts = 5
  }
}

# publish to this topic only, read from this subscription only
resource "google_pubsub_topic_iam_member" "app_publisher" {
  topic  = google_pubsub_topic.events.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:${google_service_account.app.email}"
}

resource "google_pubsub_subscription_iam_member" "app_subscriber" {
  subscription = google_pubsub_subscription.events.name
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:${google_service_account.app.email}"
}
