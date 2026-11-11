# Principle of Least Privilege in CND-IDE

CND-IDE enforces **strict role-based access** so that a developer only ever sees what they are allowed to use.

## Rules

1. **Projects**  
   The IDE only offers projects returned by Cloud Resource Manager for the current identity.

2. **Services**  
   A service appears in the Service Explorer only when both conditions are true:
   - The API is **ENABLED** in the project, and
   - The current identity holds at least one of the required permissions for that service.

3. **Hidden by default**  
   If BigQuery or any other service is not enabled or the developer lacks permissions, it is never listed.

4. **Impersonation**  
   Developers can only impersonate the three least-privilege CND service accounts.

## Default environments

Bootstrap creates **dev**, **sit**, **uat**, and **prod**, each with its own least-privilege service account and scoped roles for Cloud Run, Functions, Storage, Firestore, Gemini, BigQuery, Artifact Registry, Secret Manager, Logging, and Trace.
