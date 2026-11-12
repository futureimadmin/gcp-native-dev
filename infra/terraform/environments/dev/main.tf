/**
 * Dev environment wiring for CND Studio service accounts + APIs
 */

variable "project_id" {
  type = string
}

variable "developers_group" {
  type    = string
  default = ""
}

module "apis" {
  source     = "../../modules/apis"
  project_id = var.project_id
}

module "service_accounts" {
  source            = "../../modules/service-accounts"
  project_id        = var.project_id
  developers_group  = var.developers_group
  depends_on        = [module.apis]
}

output "service_accounts" {
  value = module.service_accounts.service_accounts
}
