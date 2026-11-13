# IntelliJ plugin — Cloud Native Development

Turns an IntelliJ project into a **Cloud Native Development project** for Google Cloud. Works in IntelliJ IDEA and other IntelliJ-platform IDEs (build 242+).

**Fonts:** the plugin sets none. It uses platform components, so it follows the IDE's own UI font and theme.

## Using it

1. **Right-click the project** in the Project view > **Cloud Native Dev > Enable Cloud Native Development** (or use the top-level **Cloud Native** menu).
2. **Sign In** (opens the browser through `gcloud`), then **Select Project**. Once signed in these become **Sign Out (account)** and **Change Project (id)**.
3. Pick an environment (dev, sit, uat, prod) with **Switch Environment** or by clicking the status bar widget.
4. Use the same menu to:
   - **Generate CI/CD Pipeline**: writes `cloudbuild.yaml` (build, push to Artifact Registry, deploy to Cloud Run).
   - **Run CI/CD Pipeline**: `gcloud builds submit` with the active environment.
   - **Deploy to Cloud Run**: `gcloud run deploy <service>-<env> --source .` (private, authenticated access only).
   - **Create Cloud Resource**: Storage bucket, Artifact Registry repository, Pub/Sub topic, Secret Manager secret.
   - **Run As Service Account**: impersonate `cnd-<env>-sa` and friends.
   - **Bootstrap Environments (Terraform)**.

In Cloud Native mode you also get a project-root marker (`☁ project · env`) in the Project view, a status bar widget, the **Cloud Native Dev** tool window (environments, CI/CD, services you can use) and a **Cloud Native Console** tool window with live command output.

## Safety

- Every command that changes cloud state is shown in full and needs a click to run. **prod** also needs you to type `prod`.
- Nothing is stored except project settings in `.idea/cnd-project.xml` and a secret-free `.cnd/project.json`. Tokens come from the gcloud CLI.
- Services are filtered by `testIamPermissions`, so you only see what you can use.

## Build

Requires JDK 21 and Gradle 8+ (no wrapper is checked in).

```bash
cd packages/intellij-plugin
gradle wrapper        # once
./gradlew runIde      # sandbox IDE with the plugin
./gradlew buildPlugin # zip in build/distributions
```

Needs the Google Cloud CLI (`gcloud`) on PATH.

> `buildPlugin` succeeds (Gradle 8.10.2, JDK 21). Version 0.2.0 has not yet been exercised in a running IDE.
