# Cloud Native Studio — Standalone Multi-Cloud IDE

## Product shift

Plugins for VS Code / IntelliJ / Eclipse remain **optional bridges**.
The primary product is a **dedicated IDE**: **Cloud Native Studio**.

Supports **GCP, AWS, and Azure** with:

1. Sign in with least privilege
2. Select cloud + account/subscription/project
3. Bootstrap environments: **dev → sit → uat → prod**
4. Configure **runtimes** (JDK, Python, Node, Go, .NET)
5. Configure **build & registry** (Maven, Nexus, npm, pip, private registries)
6. Deploy and observe from the same workspace

## Architecture

Desktop (Electron + Code-OSS) → Workbench / Env Bootstrap / Runtime Mgr / Registry Mgr → Core SDK → GCP | AWS | Azure adapters.

## Runtimes

| Runtime | Versions (examples) | Tools |
|---------|---------------------|--------|
| JDK | 17, 21, 25 | Maven, Gradle |
| Python | 3.11, 3.12, 3.13 | pip, poetry, uv |
| Node | 20, 22 | npm, pnpm, yarn |
| Go | 1.22+ | modules |
| .NET | 8, 9 | dotnet CLI |

## Package registries

Maven/Nexus, npm, PyPI, ECR/ACR/Artifact Registry — IDE writes settings.xml, .npmrc, pip.conf.
