package com.cndide.gcp

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import java.io.File

/**
 * Per-project Cloud Native Development state. Never stores tokens.
 * When [State.enabled] is true the project is in "Cloud Native Development mode".
 */
@Service(Service.Level.PROJECT)
@State(name = "CndProject", storages = [Storage("cnd-project.xml")])
class CndProject(private val project: Project) : PersistentStateComponent<CndProject.State> {
    data class State(
        var enabled: Boolean = false,
        var projectId: String = "",
        var env: String = "dev",
        var region: String = "us-central1",
        var serviceName: String = "",
        var repo: String = "cnd-apps",
        var impersonate: String = "",
    )

    private var state = State()
    val listeners = java.util.concurrent.CopyOnWriteArrayList<Runnable>()

    override fun getState() = state
    override fun loadState(s: State) {
        state = s
    }

    val enabled get() = state.enabled
    val projectId get() = state.projectId
    val env get() = state.env
    val region get() = state.region
    val repo get() = state.repo
    val impersonate get() = state.impersonate
    val service: String
        get() = state.serviceName.ifBlank { sanitize(project.name) }

    /** Cloud resource name for the active environment, e.g. myapp-dev */
    val envService get() = "$service-$env"

    fun update(block: State.() -> Unit) {
        state.block()
        if (state.enabled) writeProjectFile()
        CndBus.fire(project)
    }

    /** Shareable, secret-free description of the cloud binding at .cnd/project.json */
    private fun writeProjectFile() {
        val base = project.basePath ?: return
        runCatching {
            val f = File(base, ".cnd/project.json")
            f.parentFile.mkdirs()
            f.writeText(
                """{
  "cloud": "gcp",
  "projectId": "${state.projectId}",
  "region": "${state.region}",
  "service": "$service",
  "environments": ["dev", "sit", "uat", "prod"],
  "activeEnvironment": "${state.env}",
  "artifactRepository": "${state.repo}"
}
""",
            )
        }
    }

    companion object {
        fun get(project: Project): CndProject = project.getService(CndProject::class.java)

        fun sanitize(name: String): String =
            name.lowercase().replace(Regex("[^a-z0-9-]"), "-").trim('-').ifEmpty { "app" }.take(40)
    }
}

/** Application-wide sign-in state, cached so UI updates never block. */
object CndSession {
    @Volatile
    var account: String? = null
        private set
    @Volatile
    var checked = false
        private set

    val signedIn get() = !account.isNullOrBlank()

    fun refresh() {
        ApplicationManager.getApplication().executeOnPooledThread {
            account = GcpClient.account()
            checked = true
            CndBus.fire(null)
        }
    }
}

/** Notifies UI (tool window, status bar, project view) on the EDT. */
object CndBus {
    fun fire(project: Project?) {
        ApplicationManager.getApplication().invokeLater {
            val targets = if (project != null) listOf(project) else ProjectManager.getInstance().openProjects.toList()
            targets.filter { !it.isDisposed }.forEach { p ->
                // Show/hide the status bar widget as Cloud Native mode is toggled.
                runCatching {
                    p.getService(com.intellij.openapi.wm.impl.status.widget.StatusBarWidgetsManager::class.java)
                        .updateWidget(com.cndide.ui.CndStatusWidgetFactory::class.java)
                }
                CndProject.get(p).listeners.forEach { it.run() }
            }
        }
    }
}
