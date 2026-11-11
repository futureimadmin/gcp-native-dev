# GCP Native Dev IDE — 3-Minute Demo Narration Script

**Video file:** `docs/demo/out/gcp-native-dev-demo-3min.mp4`  
**Target length:** 3:00

---

## 0:00 – 0:15 | Title
Welcome to **GCP Native Dev IDE** — a plugin-first Cloud Native development experience for Google Cloud. Stay in VS Code, IntelliJ, or Eclipse. Ship faster, with less privilege.

## 0:15 – 0:30 | Agenda
In three minutes we will cover: signing in to only your projects, bootstrapping dev through prod, the least-privilege Service Explorer, keyless impersonation, and how this fits CI/CD and AI workloads.

## 0:30 – 0:50 | The problem
Today, developers bounce between the Cloud Console, gcloud, YAML, and long-lived service account keys. Access is often too broad, and standing up a full environment still takes days. GCP Native Dev IDE brings that into the IDE you already use — with only the access you need.

## 0:50 – 1:10 | Sign in & projects
Run **CND: Sign In**, then **CND: Set Active Project**. The IDE lists only projects your identity can access. Least privilege starts at the project picker.

## 1:10 – 1:35 | Bootstrap environments
When a project is active, the IDE asks: create default environments? Choose **Yes**. We generate a Terraform plan for **dev, sit, uat, and prod**. Each environment gets its own least-privilege service account and the default service set: Cloud Functions, Storage, Firestore, Gemini on Vertex AI, BigQuery, Artifact Registry, Secret Manager, and IAM.

## 1:35 – 2:00 | Service Explorer
Open the **Service Explorer**. You only see services that are **enabled** and for which you have real IAM permissions.

## 2:00 – 2:20 | Impersonation
**CND: Impersonate Service Account**. Pick platform-managed accounts. Short-lived token. No JSON keys on disk.

## 2:20 – 2:40 | Full lifecycle
Cloud Build and GitHub or Harness, Vertex AI and Gemini, data services, logging and tracing.

## 2:40 – 3:00 | Close
Ship cloud-native on GCP without leaving your IDE.
Clone **github.com/futureimadmin/gcp-native-dev**.
