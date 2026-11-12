# CND-IDE Architecture Overview

## Goals

- Standalone Cloud Native Studio (GCP, AWS, Azure) + optional IDE plugins
- Secure access via short-lived credentials / impersonation
- Least-privilege service visibility
- Environment bootstrap: dev → sit → uat → prod
- Runtimes (JDK, Python, Node) and registries (Maven, Nexus)

## Components

### Core SDK (`packages/core-sdk`)
Auth, service catalog, multi-cloud bootstrap, runtimes, registries.

### Desktop shell (`packages/desktop-shell`)
Electron entry toward Code-OSS workbench.

### VS Code / IntelliJ / Eclipse
Optional bridges; VS Code has MVP Service Explorer + bootstrap.

### Infrastructure (`infra/terraform`)
APIs, least-privilege service accounts, Token Creator for developers.

## Next priorities

1. Code-OSS workbench integration
2. Live AWS/Azure scope listing
3. Runtime install backends
4. Nexus/Maven apply-to-workspace
