output "app_service_account" {
  value       = google_service_account.app.email
  description = "Identity the application runs as"
}
