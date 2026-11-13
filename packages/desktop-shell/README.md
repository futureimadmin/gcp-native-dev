# Cloud Native Studio — multi-cloud IDE for Windows

A standalone desktop IDE for building, modernizing and migrating applications across **Google Cloud, AWS, Azure and private clouds**, with AI assistants built in. Core is small; clouds, AI providers, project templates and migration analyzers are **plugins** (see [docs/PLUGINS.md](docs/PLUGINS.md)).

## Run

```bash
cd packages/core-sdk && npm install && npm run build
cd ../desktop-shell && npm install
npm start            # or: npm run dev (DevTools)
npm run check        # syntax check of every source file
```

Needs Node 18+. Cloud features use each cloud's own CLI when present: `gcloud`, `aws`, `az`, `kubectl` (plus `git`, optionally `gh`).

If `npm install` leaves `node_modules/electron/dist` without `electron.exe` (seen on Node 26), extract the zip from `%LOCALAPPDATA%\electron\Cache` into `node_modules/electron/dist` and put `electron.exe` in `node_modules/electron/path.txt`.

## Windows installer

```bash
npm run dist         # release/Cloud Native Studio Setup <version>.exe (unsigned)
```

Code signing is disabled (`signAndEditExecutable: false`) because electron-builder's signing tools need symlink privileges on Windows. Expect a SmartScreen warning until you sign it.

## What happens at launch

1. Plugins load; the splash checks **Google Cloud Application Default Credentials (ADC)**.
2. **No ADC found** → you are asked to sign in (`gcloud auth login --update-adc`), or skip. **ADC found** → services start and the project stored in ADC is shown in the toolbar and status bar.
3. AWS, Azure and Kubernetes are checked in the background (they never block startup); each shows as a pill in the toolbar.
4. The first screen is **Workspace**: New Project, Open Folder, Import from GitHub, Clone, recent projects, connected clouds, AI assistants.

## Features

| Area | What you get |
|------|--------------|
| **File menu** | New Project (templates for Node, Python, AWS Lambda/SAM, Azure Functions, static site), Open Folder, Open Recent, Import from GitHub, Clone Git, Save, Settings |
| **Multi-cloud sign-in** | Signed in to several clouds at once. GCP via ADC, AWS via CLI profiles / SSO, Azure via `az login`, private/on-prem via kubeconfig contexts (OpenShift, Tanzu, Rancher, EKS/GKE/AKS) |
| **Least-privilege inventory** | Lists only what the identity can use (GCP `testIamPermissions`; AWS/K8s hide access-denied resources) |
| **Cloud Native mode** | Right-click a project → Enable. Run CI/CD, Deploy, Create resource, Generate pipeline, Terraform bootstrap, dev/sit/uat/prod environments |
| **Safety** | Every cloud-changing command is shown in full and needs a click; prod also needs typing `prod`. The UI can only run commands the main process prepared (one-time token) |
| **AI** | Chat with Claude, Gemini, Grok or any OpenAI-compatible/local model (Ollama keeps code on your machine). Launch Claude Code, Gemini CLI or Codex CLI in a terminal window. Keys are stored encrypted with the Windows keystore |
| **Modernize & Migrate** | Scans the project, maps it to services on GCP / AWS / Azure / Kubernetes, 6R strategy per component, phased plan saved to `docs/migration/`, "Ask AI to refine" |
| **Plugins** | Add clouds, AI providers, templates and analyzers. Third-party plugins are disabled until you enable them |

## Notes and limits

- The built-in terminal is a command runner, not a full PTY. Interactive AI agents open in a real console window.
- AI chat is request/response (no streaming yet). Model names are editable because vendors rename them; the defaults are starting points.
- AWS deploy needs a SAM `template.yaml`; the AWS/Azure pipeline "run" actions start an existing CodeBuild project / Azure Pipeline named `<service>-<env>`.
- Not yet verified against live AWS/Azure accounts: sign-in flows and resource commands for those clouds were built from CLI documentation, and Azure CLI was not installed on the test machine.
- The installer is unsigned.
