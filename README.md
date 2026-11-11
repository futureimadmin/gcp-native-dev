# GCP Native Dev IDE

**Plugin-first Cloud Native Development IDE for Google Cloud Platform.**

Native extensions for **VS Code**, **IntelliJ / JetBrains**, and **Eclipse**.

- Create projects and environments: **dev → sit → uat → prod**
- Optional **default setup** on load (CI/CD, Cloud Functions, Storage, Firestore/DB, Gemini, BigQuery, Artifact Registry, Secret Manager, IAM)
- **Principle of Least Privilege**: only projects and services the developer can access are shown
- Service Account **impersonation** (no long-lived keys)
- Designed for Harness CI/CD, Dynatrace, Cloud Logging & Trace

**Repository:** https://github.com/futureimadmin/gcp-native-dev

---

## Repository layout

```
gcp-native-dev/
├── packages/
│   ├── core-sdk/           # Shared auth, service catalog, project bootstrap
│   ├── vscode-extension/   # VS Code extension (primary)
│   ├── intellij-plugin/    # IntelliJ / JetBrains plugin (scaffold)
│   └── eclipse-plugin/     # Eclipse plugin (scaffold)
├── infra/
│   └── terraform/          # Service accounts, APIs, bootstrap modules
├── docs/
│   ├── architecture/
│   └── security/           # Least privilege + impersonation
└── scripts/
```

Each plugin lives in its **own directory** under `packages/`.

---

## Quick start (VS Code)

```bash
git clone https://github.com/futureimadmin/gcp-native-dev.git
cd gcp-native-dev/packages/core-sdk && npm install && npm run build
cd ../vscode-extension && npm install
# Open folder in VS Code → F5 (Extension Development Host)
```

Commands:

| Command | Description |
|---------|-------------|
| **CND: Sign In** | Authenticate (ADC / gcloud) |
| **CND: Set Active Project** | Only projects you can access |
| **CND: Bootstrap Project & Environments** | Create dev/sit/uat/prod + default services |
| **CND: Impersonate Service Account** | Short-lived SA token |
| **CND: Refresh Service Explorer** | Reload accessible services |

On first load (or when a project is active), the IDE asks whether to run **default setup**.

---

## Default setup (what gets created)

When the user chooses **Yes – Default Setup**:

**Environments:** `dev`, `sit`, `uat`, `prod`

**Per environment (least-privilege service account):**
- Cloud Run / Cloud Functions developer
- Cloud Storage object admin
- Firestore / Datastore user
- Vertex AI (Gemini) user
- BigQuery data editor + job user
- Artifact Registry writer
- Secret Manager accessor
- Logging + Trace viewer

**Shared:**
- Required APIs enabled
- Artifact Registry Docker repository
- Terraform plan written to `infra/cnd-bootstrap/main.tf`

Apply with:

```bash
cd infra/cnd-bootstrap
terraform init && terraform apply
```

---

## Principle of Least Privilege

1. Only **projects** the identity can access appear in the picker.
2. Only **services** that are **enabled** and for which the identity has at least one required permission appear in Service Explorer.
3. BigQuery, IAM surfaces, etc. are **hidden** if the developer has no access.
4. Impersonation is limited to the CND least-privilege service accounts.

See [docs/security/least-privilege.md](docs/security/least-privilege.md).

---

## Terraform (platform team)

```bash
cd infra/terraform/environments/dev
export TF_VAR_project_id="your-gcp-project"
# optional: export TF_VAR_developers_group="developers@yourdomain.com"
terraform init && terraform apply
```

Creates `cnd-dev-sa`, `cnd-cicd-sa`, `cnd-obs-sa` and grants Token Creator to the developers group.

---

## Status

| Component | Status |
|-----------|--------|
| Core SDK – Auth & Impersonation | Implemented |
| Core SDK – Service Catalog (PoLP) | Implemented |
| Core SDK – Project / Env Bootstrap | Implemented |
| VS Code Extension | Implemented (MVP) |
| IntelliJ Plugin | Scaffold |
| Eclipse Plugin | Scaffold |
| Harness / Dynatrace deep integration | Planned |

---

## License

Apache-2.0
