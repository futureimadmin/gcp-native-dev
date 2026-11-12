# Service Account Impersonation

Developers authenticate as themselves. Elevated access uses short-lived tokens for platform-managed identities.

## GCP

- SAs: `cnd-dev-sa`, `cnd-cicd-sa`, `cnd-obs-sa`
- Developers need `roles/iam.serviceAccountTokenCreator` on those SAs
- Tokens ~1 hour; no JSON keys in the workspace

## AWS

- IAM roles `cnd-dev-role` … `cnd-prod-role`
- AssumeRole / STS session tags for environment

## Azure

- User-assigned managed identities per environment
- Federated credentials preferred over client secrets

## IDE behavior

Status view shows active scope and whether an identity is being impersonated.
