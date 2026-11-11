# Cloud Native Studio

**Standalone multi-cloud IDE** for **GCP**, **AWS**, and **Azure**.

Not only plugins — a dedicated IDE with the same bootstrap model on every cloud:

- Environments: **dev → sit → uat → prod**
- **Runtimes**: JDK, Python, Node, Go, .NET
- **Build & registries**: Maven, Gradle, Nexus, npm, PyPI, container registries
- **Least privilege**: only scopes and services you can use
- Short-lived credentials (GCP SA impersonation, AWS STS, Azure managed identity)

Optional **bridges** still exist for VS Code, IntelliJ, and Eclipse.

**Repository:** https://github.com/futureimadmin/gcp-native-dev

## Product shape

| Layer | Package | Role |
|-------|---------|------|
| **Desktop IDE** | `packages/desktop-shell` | Electron shell → Code-OSS workbench |
| **Core SDK** | `packages/core-sdk` | Auth, PoLP catalog, bootstrap, runtimes, registries |
| **Cloud adapters** | `packages/core-sdk/src/cloud` | GCP / AWS / Azure bootstrap plans |
| **VS Code bridge** | `packages/vscode-extension` | Optional plugin |
| **IntelliJ / Eclipse** | `packages/intellij-plugin`, `eclipse-plugin` | Optional plugins |

See [docs/architecture/standalone-ide.md](docs/architecture/standalone-ide.md).

## Bootstrap flow (all clouds)

1. Sign in to GCP, AWS, or Azure
2. Select scope (project / account / subscription) — only what you can access
3. IDE asks: **Create default environments?**
4. On yes: generates IaC for dev·sit·uat·prod
5. Per-env least-privilege identity + default services

## Runtimes & tools

Toolchain profiles: JDK 17/21/25 + Maven/Gradle, Python 3.11+, Node 20/22, Go, .NET.
Registries: Nexus, Artifactory, CodeArtifact, Artifact Registry, ECR, ACR.

## License

Apache-2.0
