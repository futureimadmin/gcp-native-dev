package com.cndide.eclipse.gcp;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Cloud Resource Manager / Service Usage client using a token from the gcloud CLI.
 * Blocking; call from a Job, never from the UI thread.
 */
public final class GcpClient {
    public record Project(String id, String name) {}

    public record Service(String name, String title, String category, String consoleUrl) {
        @Override
        public String toString() {
            return title;
        }
    }

    private record Def(String title, String category, String console, String probe) {}

    private static final Map<String, Def> DEFS = new LinkedHashMap<>();
    static {
        DEFS.put("run.googleapis.com", new Def("Cloud Run", "Compute", "run", "run.services.list"));
        DEFS.put("cloudfunctions.googleapis.com", new Def("Cloud Functions", "Compute", "functions/list", "cloudfunctions.functions.list"));
        DEFS.put("container.googleapis.com", new Def("Kubernetes Engine", "Compute", "kubernetes/list", "container.clusters.list"));
        DEFS.put("storage.googleapis.com", new Def("Cloud Storage", "Storage & Databases", "storage/browser", "storage.buckets.list"));
        DEFS.put("firestore.googleapis.com", new Def("Firestore", "Storage & Databases", "firestore", "datastore.databases.list"));
        DEFS.put("sqladmin.googleapis.com", new Def("Cloud SQL", "Storage & Databases", "sql/instances", "cloudsql.instances.list"));
        DEFS.put("bigquery.googleapis.com", new Def("BigQuery", "AI & Analytics", "bigquery", "bigquery.datasets.get"));
        DEFS.put("aiplatform.googleapis.com", new Def("Vertex AI / Gemini", "AI & Analytics", "vertex-ai", "aiplatform.endpoints.list"));
        DEFS.put("cloudbuild.googleapis.com", new Def("Cloud Build", "DevOps & CI/CD", "cloud-build/builds", "cloudbuild.builds.list"));
        DEFS.put("artifactregistry.googleapis.com", new Def("Artifact Registry", "DevOps & CI/CD", "artifacts", "artifactregistry.repositories.list"));
        DEFS.put("secretmanager.googleapis.com", new Def("Secret Manager", "Security & Identity", "security/secret-manager", "secretmanager.secrets.list"));
        DEFS.put("iam.googleapis.com", new Def("IAM", "Security & Identity", "iam-admin/iam", "resourcemanager.projects.getIamPolicy"));
        DEFS.put("logging.googleapis.com", new Def("Cloud Logging", "Observability", "logs", "logging.logEntries.list"));
        DEFS.put("cloudtrace.googleapis.com", new Def("Cloud Trace", "Observability", "traces", "cloudtrace.traces.get"));
    }

    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build();

    private GcpClient() {}

    public static String gcloud() {
        return System.getProperty("os.name", "").toLowerCase().contains("win") ? "gcloud.cmd" : "gcloud";
    }

    private static String run(List<String> cmd) throws IOException, InterruptedException {
        Process p = new ProcessBuilder(cmd).redirectErrorStream(false).start();
        String out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
        String err = new String(p.getErrorStream().readAllBytes(), StandardCharsets.UTF_8).trim();
        if (p.waitFor() != 0 || out.isEmpty()) throw new IOException("Not signed in or impersonation denied. " + (err.length() > 200 ? err.substring(0, 200) : err));
        return out;
    }

    private static String token(String impersonate) throws IOException, InterruptedException {
        List<String> cmd = new ArrayList<>(List.of(gcloud(), "auth", "print-access-token"));
        if (impersonate != null && !impersonate.isBlank()) cmd.add("--impersonate-service-account=" + impersonate);
        return run(cmd);
    }

    private static Map<String, Object> call(String url, String impersonate, String body) throws IOException, InterruptedException {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url))
                .header("Authorization", "Bearer " + token(impersonate))
                .header("Content-Type", "application/json")
                .timeout(Duration.ofSeconds(30));
        HttpRequest req = body != null ? b.POST(HttpRequest.BodyPublishers.ofString(body)).build() : b.GET().build();
        HttpResponse<String> res = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() / 100 != 2) {
            String t = res.body();
            throw new IOException(res.statusCode() + ": " + (t.length() > 300 ? t.substring(0, 300) : t));
        }
        return MiniJson.object(res.body());
    }

    @SuppressWarnings("unchecked")
    public static List<Project> projects(String impersonate) throws IOException, InterruptedException {
        List<Project> out = new ArrayList<>();
        String page = "";
        do {
            Map<String, Object> r = call("https://cloudresourcemanager.googleapis.com/v1/projects?filter=lifecycleState:ACTIVE&pageSize=200" + page, impersonate, null);
            Object list = r.get("projects");
            if (list instanceof List<?> l) {
                for (Object o : l) {
                    Map<String, Object> m = (Map<String, Object>) o;
                    out.add(new Project((String) m.get("projectId"), (String) m.get("name")));
                }
            }
            page = r.get("nextPageToken") instanceof String t ? "&pageToken=" + t : "";
        } while (!page.isEmpty());
        return out;
    }

    /** Enabled services, hiding those the caller holds no probe permission for (least privilege). */
    @SuppressWarnings("unchecked")
    public static List<Service> services(String projectId, String impersonate) throws IOException, InterruptedException {
        Set<String> enabled = new HashSet<>();
        String page = "";
        do {
            Map<String, Object> r = call("https://serviceusage.googleapis.com/v1/projects/" + projectId + "/services?filter=state:ENABLED&pageSize=200" + page, impersonate, null);
            if (r.get("services") instanceof List<?> l) {
                for (Object o : l) {
                    String n = (String) ((Map<String, Object>) o).get("name");
                    enabled.add(n.substring(n.lastIndexOf('/') + 1));
                }
            }
            page = r.get("nextPageToken") instanceof String t ? "&pageToken=" + t : "";
        } while (!page.isEmpty());

        Set<String> granted = new HashSet<>();
        boolean probed = false;
        try {
            StringBuilder b = new StringBuilder("{\"permissions\":[");
            boolean first = true;
            for (Def d : DEFS.values()) {
                if (!first) b.append(',');
                b.append('"').append(d.probe()).append('"');
                first = false;
            }
            b.append("]}");
            Map<String, Object> r = call("https://cloudresourcemanager.googleapis.com/v1/projects/" + projectId + ":testIamPermissions", impersonate, b.toString());
            if (r.get("permissions") instanceof List<?> l) for (Object o : l) granted.add((String) o);
            probed = true;
        } catch (IOException ignored) {
            // probe failed: fall back to showing enabled services
        }

        List<Service> out = new ArrayList<>();
        for (Map.Entry<String, Def> e : DEFS.entrySet()) {
            Def d = e.getValue();
            if (!enabled.contains(e.getKey())) continue;
            if (probed && !granted.contains(d.probe())) continue;
            out.add(new Service(e.getKey(), d.title(), d.category(), "https://console.cloud.google.com/" + d.console() + "?project=" + projectId));
        }
        return out;
    }

    /** Generates Terraform for dev/sit/uat/prod. Nothing is applied. */
    public static String terraform(String projectId, List<String> envs, String region) {
        String[] apis = {"cloudbuild", "cloudfunctions", "storage", "firestore", "sqladmin", "aiplatform", "bigquery",
                "artifactregistry", "secretmanager", "iam", "iamcredentials", "logging", "cloudtrace", "run", "container"};
        StringBuilder b = new StringBuilder("# Generated by Cloud Native Development IDE\n");
        b.append("variable \"project_id\" {\n  type    = string\n  default = \"").append(projectId).append("\"\n}\n");
        b.append("variable \"region\" {\n  type    = string\n  default = \"").append(region).append("\"\n}\n\n");
        for (int i = 0; i < apis.length; i++) {
            b.append("resource \"google_project_service\" \"api_").append(i).append("\" {\n  project            = var.project_id\n  service            = \"")
                    .append(apis[i]).append(".googleapis.com\"\n  disable_on_destroy = false\n}\n\n");
        }
        for (String e : envs) {
            b.append("resource \"google_service_account\" \"").append(e).append("\" {\n  account_id   = \"cnd-").append(e)
                    .append("-sa\"\n  display_name = \"CND ").append(e.toUpperCase()).append(" environment\"\n  project      = var.project_id\n}\n\n");
        }
        return b.toString();
    }

    public static void writeFile(Path target, String content) throws IOException {
        Files.createDirectories(target.getParent());
        Files.writeString(target, content, StandardCharsets.UTF_8);
    }
}
