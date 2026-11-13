package com.cndide.gcp

import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.util.ExecUtil
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

data class GcpProject(val id: String, val name: String)

data class GcpService(val name: String, val title: String, val category: String, val consoleUrl: String) {
    override fun toString() = title
}

private data class Def(val title: String, val category: String, val console: String, val probe: List<String>)

/**
 * Talks to Cloud Resource Manager / Service Usage using a token from the gcloud CLI.
 * Blocking: call from a background thread only.
 */
object GcpClient {
    private val http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build()

    private val DEFS = linkedMapOf(
        "run.googleapis.com" to Def("Cloud Run", "Compute", "run", listOf("run.services.list")),
        "cloudfunctions.googleapis.com" to Def("Cloud Functions", "Compute", "functions/list", listOf("cloudfunctions.functions.list")),
        "container.googleapis.com" to Def("Kubernetes Engine", "Compute", "kubernetes/list", listOf("container.clusters.list")),
        "storage.googleapis.com" to Def("Cloud Storage", "Storage & Databases", "storage/browser", listOf("storage.buckets.list")),
        "firestore.googleapis.com" to Def("Firestore", "Storage & Databases", "firestore", listOf("datastore.databases.list")),
        "sqladmin.googleapis.com" to Def("Cloud SQL", "Storage & Databases", "sql/instances", listOf("cloudsql.instances.list")),
        "bigquery.googleapis.com" to Def("BigQuery", "AI & Analytics", "bigquery", listOf("bigquery.datasets.get")),
        "aiplatform.googleapis.com" to Def("Vertex AI / Gemini", "AI & Analytics", "vertex-ai", listOf("aiplatform.endpoints.list")),
        "cloudbuild.googleapis.com" to Def("Cloud Build", "DevOps & CI/CD", "cloud-build/builds", listOf("cloudbuild.builds.list")),
        "artifactregistry.googleapis.com" to Def("Artifact Registry", "DevOps & CI/CD", "artifacts", listOf("artifactregistry.repositories.list")),
        "secretmanager.googleapis.com" to Def("Secret Manager", "Security & Identity", "security/secret-manager", listOf("secretmanager.secrets.list")),
        "iam.googleapis.com" to Def("IAM", "Security & Identity", "iam-admin/iam", listOf("resourcemanager.projects.getIamPolicy")),
        "logging.googleapis.com" to Def("Cloud Logging", "Observability", "logs", listOf("logging.logEntries.list")),
        "cloudtrace.googleapis.com" to Def("Cloud Trace", "Observability", "traces", listOf("cloudtrace.traces.get")),
    )

    fun gcloud(): String = if (System.getProperty("os.name").lowercase().contains("win")) "gcloud.cmd" else "gcloud"

    private val LOG = com.intellij.openapi.diagnostic.Logger.getInstance(GcpClient::class.java)

    /** Active gcloud account, or null when signed out. Blocking. */
    fun account(): String? = runCatching {
        val o = ExecUtil.execAndGetOutput(GeneralCommandLine(gcloud(), "auth", "list", "--filter=status:ACTIVE", "--format=value(account)"))
        o.stdout.trim().lines().firstOrNull()?.trim()?.takeIf { o.exitCode == 0 && it.isNotEmpty() }
    }.onFailure { LOG.warn("gcloud account lookup failed", it) }.getOrNull()

    private fun token(impersonate: String): String {
        val cmd = GeneralCommandLine(gcloud(), "auth", "print-access-token")
        if (impersonate.isNotBlank()) cmd.addParameter("--impersonate-service-account=$impersonate")
        val o = ExecUtil.execAndGetOutput(cmd)
        if (o.exitCode != 0 || o.stdout.isBlank()) error("Not signed in or impersonation denied. ${o.stderr.take(200)}")
        return o.stdout.trim()
    }

    private fun call(url: String, impersonate: String, body: String? = null): JsonObject {
        val b = HttpRequest.newBuilder(URI.create(url))
            .header("Authorization", "Bearer ${token(impersonate)}")
            .header("Content-Type", "application/json")
            .timeout(Duration.ofSeconds(30))
        val req = if (body != null) b.POST(HttpRequest.BodyPublishers.ofString(body)).build() else b.GET().build()
        val res = http.send(req, HttpResponse.BodyHandlers.ofString())
        if (res.statusCode() !in 200..299) error("${res.statusCode()}: ${res.body().take(300)}")
        return JsonParser.parseString(res.body()).asJsonObject
    }

    fun projects(impersonate: String): List<GcpProject> {
        val out = mutableListOf<GcpProject>()
        var page = ""
        do {
            val r = call("https://cloudresourcemanager.googleapis.com/v1/projects?filter=lifecycleState:ACTIVE&pageSize=200$page", impersonate)
            r.getAsJsonArray("projects")?.forEach {
                out += GcpProject(it.asJsonObject["projectId"].asString, it.asJsonObject["name"].asString)
            }
            page = r["nextPageToken"]?.asString?.let { "&pageToken=$it" } ?: ""
        } while (page.isNotEmpty())
        return out
    }

    /** Enabled services, hiding those the caller holds no probe permission for (least privilege). */
    fun services(projectId: String, impersonate: String): List<GcpService> {
        val enabled = mutableSetOf<String>()
        var page = ""
        do {
            val r = call("https://serviceusage.googleapis.com/v1/projects/$projectId/services?filter=state:ENABLED&pageSize=200$page", impersonate)
            r.getAsJsonArray("services")?.forEach { enabled += it.asJsonObject["name"].asString.substringAfterLast('/') }
            page = r["nextPageToken"]?.asString?.let { "&pageToken=$it" } ?: ""
        } while (page.isNotEmpty())

        val probes = DEFS.values.flatMap { it.probe }.distinct()
        val granted: Set<String> = runCatching {
            val arr = JsonArray().also { a -> probes.forEach { a.add(it) } }
            val body = JsonObject().also { it.add("permissions", arr) }
            call("https://cloudresourcemanager.googleapis.com/v1/projects/$projectId:testIamPermissions", impersonate, body.toString())
                .getAsJsonArray("permissions")?.map { it.asString }?.toSet() ?: emptySet()
        }.getOrDefault(probes.toSet())

        return DEFS.filter { (k, d) -> k in enabled && d.probe.any { it in granted } }.map { (k, d) ->
            GcpService(k, d.title, d.category, "https://console.cloud.google.com/${d.console}?project=$projectId")
        }
    }
}

/** Generates Terraform for the dev/sit/uat/prod bootstrap. Nothing is applied. */
object Bootstrap {
    val ENVS = listOf("dev", "sit", "uat", "prod")
    private val APIS = listOf(
        "cloudbuild", "cloudfunctions", "storage", "firestore", "sqladmin", "aiplatform", "bigquery",
        "artifactregistry", "secretmanager", "iam", "iamcredentials", "logging", "cloudtrace", "run", "container",
    ).map { "$it.googleapis.com" }

    fun terraform(projectId: String, envs: List<String>, region: String): String = buildString {
        appendLine("# Generated by Cloud Native Development IDE")
        appendLine("variable \"project_id\" {\n  type    = string\n  default = \"$projectId\"\n}")
        appendLine("variable \"region\" {\n  type    = string\n  default = \"$region\"\n}\n")
        APIS.forEachIndexed { i, s ->
            appendLine("resource \"google_project_service\" \"api_$i\" {\n  project            = var.project_id\n  service            = \"$s\"\n  disable_on_destroy = false\n}\n")
        }
        envs.forEach { e ->
            appendLine("resource \"google_service_account\" \"$e\" {\n  account_id   = \"cnd-$e-sa\"\n  display_name = \"CND ${e.uppercase()} environment\"\n  project      = var.project_id\n}\n")
        }
    }
}
