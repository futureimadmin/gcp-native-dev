#@cloudtasks Cloud Tasks queue
resource "google_cloud_tasks_queue" "work" {
  name     = "${local.name}-work"
  location = var.region
}

# add tasks to this queue only
resource "google_cloud_tasks_queue_iam_member" "app_enqueuer" {
  name     = google_cloud_tasks_queue.work.name
  location = var.region
  role     = "roles/cloudtasks.enqueuer"
  member   = "serviceAccount:${google_service_account.app.email}"
}
