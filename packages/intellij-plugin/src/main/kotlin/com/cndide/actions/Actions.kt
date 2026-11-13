package com.cndide.actions

import com.cndide.gcp.Bootstrap
import com.cndide.gcp.CndBus
import com.cndide.gcp.CndProject
import com.cndide.gcp.CndSession
import com.cndide.gcp.GcpClient
import com.cndide.gcp.GcpProject
import com.cndide.gcp.Pipeline
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.filters.TextConsoleBuilderFactory
import com.intellij.execution.process.OSProcessHandler
import com.intellij.execution.process.ProcessAdapter
import com.intellij.execution.process.ProcessEvent
import com.intellij.execution.ui.ConsoleViewContentType
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.ide.BrowserUtil
import com.intellij.ui.content.ContentFactory
import java.io.File
import java.nio.charset.StandardCharsets

const val TOOL_WINDOW = "Cloud Native Dev"
const val CONSOLE_WINDOW = "Cloud Native Console"
private const val TITLE = "Cloud Native Dev"

internal fun notify(project: Project?, msg: String, type: NotificationType = NotificationType.INFORMATION) {
    NotificationGroupManager.getInstance().getNotificationGroup("Cloud Native Dev")
        .createNotification(msg, type).notify(project)
}

internal fun background(project: Project?, title: String, work: () -> Unit, done: () -> Unit = {}) {
    ProgressManager.getInstance().run(object : Task.Backgroundable(project, title, false) {
        override fun run(indicator: ProgressIndicator) {
            try {
                work()
            } catch (e: Exception) {
                notify(project, e.message ?: e.toString(), NotificationType.ERROR)
            }
        }

        override fun onFinished() {
            done()
        }
    })
}

/** Runs a command in the "Cloud Native Console" tool window with live output. */
object Runner {
    fun run(project: Project, title: String, args: List<String>, onDone: (Int) -> Unit = {}) {
        val tw = ToolWindowManager.getInstance(project).getToolWindow(CONSOLE_WINDOW) ?: return
        val console = TextConsoleBuilderFactory.getInstance().createBuilder(project).console
        val content = ContentFactory.getInstance().createContent(console.component, title, false)
        content.setDisposer(console)
        tw.contentManager.addContent(content)
        tw.contentManager.setSelectedContent(content)
        tw.show()
        console.print("> ${args.joinToString(" ")}\n", ConsoleViewContentType.SYSTEM_OUTPUT)
        try {
            val handler = OSProcessHandler(GeneralCommandLine(args).withWorkDirectory(project.basePath).withCharset(StandardCharsets.UTF_8))
            console.attachToProcess(handler)
            handler.addProcessListener(object : ProcessAdapter() {
                override fun processTerminated(event: ProcessEvent) {
                    val ok = event.exitCode == 0
                    notify(project, "$title ${if (ok) "succeeded" else "failed (exit ${event.exitCode})"}", if (ok) NotificationType.INFORMATION else NotificationType.ERROR)
                    onDone(event.exitCode)
                }
            })
            handler.startNotify()
        } catch (e: Exception) {
            console.print("Unable to start gcloud: ${e.message}\nInstall the Google Cloud CLI and make sure it is on PATH.\n", ConsoleViewContentType.ERROR_OUTPUT)
        }
    }
}

/** Confirms a command that changes cloud state, showing exactly what will run. Production needs a second confirmation. */
private fun confirmRun(project: Project, cnd: CndProject, what: String, cmd: List<String>): Boolean {
    val msg = "$what\n\nProject: ${cnd.projectId}\nEnvironment: ${cnd.env}\n\nCommand:\n${cmd.joinToString(" ")}"
    if (Messages.showYesNoDialog(project, msg, TITLE, "Run", "Cancel", Messages.getQuestionIcon()) != Messages.YES) return false
    if (cnd.env == "prod") {
        val typed = Messages.showInputDialog(project, "This targets PRODUCTION. Type prod to continue:", TITLE, Messages.getWarningIcon())
        if (typed?.trim() != "prod") return false
    }
    return true
}

/** Shared flows */
object Flows {
    fun selectProject(project: Project) {
        val cnd = CndProject.get(project)
        background(project, "Listing projects", {
            val list: List<GcpProject> = GcpClient.projects(cnd.impersonate)
            ApplicationManager.getApplication().invokeLater {
                if (list.isEmpty()) {
                    notify(project, "No accessible projects.", NotificationType.WARNING)
                    return@invokeLater
                }
                val labels = list.map { "${it.id} — ${it.name}" }.toTypedArray()
                val i = Messages.showChooseDialog("Select the Google Cloud project for this IDE project", TITLE, labels, labels[0], null)
                if (i >= 0) cnd.update { projectId = list[i].id }
            }
        })
    }

    fun requireReady(project: Project, cnd: CndProject): Boolean {
        if (!CndSession.signedIn) {
            Messages.showWarningDialog(project, "Sign in to Google Cloud first.", TITLE)
            return false
        }
        if (cnd.projectId.isBlank()) {
            Messages.showWarningDialog(project, "Select a Google Cloud project first.", TITLE)
            return false
        }
        return true
    }
}

/** Base for actions that read state on the EDT only. */
abstract class CndAction : AnAction() {
    override fun getActionUpdateThread() = ActionUpdateThread.EDT
}

/** Shows only in Cloud Native mode and when signed in with a project selected. */
abstract class CloudAction : CndAction() {
    override fun update(e: AnActionEvent) {
        val p = e.project
        val cnd = p?.let { CndProject.get(it) }
        e.presentation.isVisible = cnd?.enabled == true
        e.presentation.isEnabled = cnd?.enabled == true && CndSession.signedIn && cnd.projectId.isNotBlank()
    }
}

class SignInAction : CndAction() {
    override fun update(e: AnActionEvent) {
        e.presentation.text = if (CndSession.signedIn) "Sign Out (${CndSession.account})" else "Sign In"
        e.presentation.description = if (CndSession.signedIn) "Sign out of Google Cloud" else "Sign in to Google Cloud"
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project
        val account = CndSession.account
        if (account != null) {
            if (Messages.showYesNoDialog(project, "Sign out $account from the gcloud CLI?\nThis affects other tools that use the same gcloud login.", TITLE, "Sign Out", "Cancel", Messages.getQuestionIcon()) != Messages.YES) return
            background(project, "Signing out", {
                GeneralCommandLine(GcpClient.gcloud(), "auth", "revoke", account).createProcess().waitFor()
            }, { CndSession.refresh() })
        } else {
            // gcloud opens the system browser for Google sign-in.
            background(project, "Signing in to Google Cloud", {
                GeneralCommandLine(GcpClient.gcloud(), "auth", "login").createProcess().waitFor()
            }, { CndSession.refresh() })
        }
    }
}

class SelectProjectAction : CndAction() {
    override fun update(e: AnActionEvent) {
        val id = e.project?.let { CndProject.get(it).projectId }.orEmpty()
        e.presentation.text = if (id.isBlank()) "Select Project…" else "Change Project ($id)…"
        e.presentation.isEnabled = CndSession.signedIn && e.project != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        Flows.selectProject(e.project ?: return)
    }
}

class SwitchEnvAction : CloudAction() {
    override fun update(e: AnActionEvent) {
        super.update(e)
        val env = e.project?.let { CndProject.get(it).env }.orEmpty()
        e.presentation.text = "Switch Environment ($env)…"
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val cnd = CndProject.get(project)
        val envs = Pipeline.ENVS.toTypedArray()
        val i = Messages.showChooseDialog("Active environment", TITLE, envs, cnd.env, null)
        if (i >= 0) cnd.update { env = envs[i] }
    }
}

class ImpersonateSaAction : CloudAction() {
    override fun update(e: AnActionEvent) {
        super.update(e)
        val sa = e.project?.let { CndProject.get(it).impersonate }.orEmpty()
        e.presentation.text = if (sa.isBlank()) "Run As Service Account…" else "Run As: ${sa.substringBefore('@')}…"
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val cnd = CndProject.get(project)
        val sfx = "@${cnd.projectId}.iam.gserviceaccount.com"
        val opts = arrayOf("My user credentials", "cnd-${cnd.env}-sa$sfx", "cnd-dev-sa$sfx", "cnd-cicd-sa$sfx", "cnd-obs-sa$sfx")
        val i = Messages.showChooseDialog("Run cloud commands as", TITLE, opts, opts[0], null)
        if (i < 0) return
        val target = if (i == 0) "" else opts[i]
        background(project, "Validating impersonation", {
            GcpClient.projects(target) // fails fast if impersonation is denied
            cnd.update { impersonate = target }
        })
    }
}

/** Right-click the project: turns Cloud Native Development mode on or off. */
class EnableCloudNativeAction : CndAction() {
    override fun update(e: AnActionEvent) {
        val p = e.project
        e.presentation.isVisible = p != null
        e.presentation.text = if (p != null && CndProject.get(p).enabled) "Disable Cloud Native Development" else "Enable Cloud Native Development"
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val cnd = CndProject.get(project)
        if (cnd.enabled) {
            if (Messages.showYesNoDialog(project, "Turn off Cloud Native Development for this project?\nNothing in the cloud is changed.", TITLE, "Disable", "Cancel", Messages.getQuestionIcon()) == Messages.YES) {
                cnd.update { enabled = false }
            }
            return
        }
        cnd.update { enabled = true }
        ToolWindowManager.getInstance(project).getToolWindow(TOOL_WINDOW)?.show()
        if (!CndSession.signedIn) notify(project, "Cloud Native Development enabled. Sign in to Google Cloud to continue.")
        else if (cnd.projectId.isBlank()) Flows.selectProject(project)
    }
}

class GeneratePipelineAction : CloudAction() {
    override fun update(e: AnActionEvent) {
        val p = e.project
        e.presentation.isVisible = p != null && CndProject.get(p).enabled
        e.presentation.isEnabled = e.presentation.isVisible
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val base = project.basePath ?: return
        val file = File(base, "cloudbuild.yaml")
        if (file.exists() && Messages.showYesNoDialog(project, "cloudbuild.yaml already exists. Overwrite it?", TITLE, "Overwrite", "Cancel", Messages.getWarningIcon()) != Messages.YES) return
        file.writeText(Pipeline.cloudBuildYaml(Pipeline.hasDockerfile(base)))
        LocalFileSystem.getInstance().refreshAndFindFileByIoFile(file)?.let { FileEditorManager.getInstance(project).openFile(it, true) }
        CndBus.fire(project)
        notify(project, "Wrote cloudbuild.yaml. Use Run CI/CD Pipeline to build and deploy.")
    }
}

class RunPipelineAction : CloudAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val cnd = CndProject.get(project)
        if (!Flows.requireReady(project, cnd)) return
        if (!Pipeline.hasPipeline(project.basePath)) {
            if (Messages.showYesNoDialog(project, "No cloudbuild.yaml in this project. Generate one now?", TITLE, "Generate", "Cancel", Messages.getQuestionIcon()) == Messages.YES) {
                GeneratePipelineAction().actionPerformed(e)
            }
            return
        }
        val cmd = Pipeline.submit(cnd)
        if (confirmRun(project, cnd, "Run the Cloud Build CI/CD pipeline (build, push, deploy to Cloud Run).", cmd)) {
            Runner.run(project, "CI/CD ${cnd.envService}", cmd)
        }
    }
}

class DeployAction : CloudAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val cnd = CndProject.get(project)
        if (!Flows.requireReady(project, cnd)) return
        val cmd = Pipeline.deploy(cnd)
        if (confirmRun(project, cnd, "Deploy this project to Cloud Run as ${cnd.envService} (private, authenticated access only).", cmd)) {
            Runner.run(project, "Deploy ${cnd.envService}", cmd)
        }
    }
}

class CreateResourceAction : CloudAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val cnd = CndProject.get(project)
        if (!Flows.requireReady(project, cnd)) return
        val kinds = Pipeline.RESOURCES
        val i = Messages.showChooseDialog("Resource to create in ${cnd.projectId} (${cnd.env})", TITLE, kinds.map { it.label }.toTypedArray(), kinds[0].label, null)
        if (i < 0) return
        val kind = kinds[i]
        val name = Messages.showInputDialog(project, "Name for the ${kind.label}:", TITLE, null, kind.defaultName(cnd), null)?.trim()
        if (name.isNullOrEmpty()) return
        val cmd = kind.command(cnd, name)
        if (confirmRun(project, cnd, "Create ${kind.label} \"$name\".", cmd)) Runner.run(project, "Create $name", cmd)
    }
}

class OpenConsoleAction : CloudAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val cnd = CndProject.get(e.project ?: return)
        BrowserUtil.browse("https://console.cloud.google.com/home/dashboard?project=${cnd.projectId}")
    }
}

class BootstrapAction : CloudAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val cnd = CndProject.get(project)
        val base = project.basePath ?: return
        val ok = Messages.showYesNoDialog(
            project,
            "Write Terraform for ${Bootstrap.ENVS.joinToString(", ")} to infra/cnd-bootstrap/gcp/main.tf?\nNothing is applied to your cloud account.",
            TITLE, "Write", "Cancel", Messages.getQuestionIcon(),
        )
        if (ok != Messages.YES) return
        val file = File(base, "infra/cnd-bootstrap/gcp/main.tf")
        file.parentFile.mkdirs()
        file.writeText(Bootstrap.terraform(cnd.projectId.ifBlank { "my-project" }, Bootstrap.ENVS, cnd.region))
        LocalFileSystem.getInstance().refreshAndFindFileByIoFile(file)?.let { FileEditorManager.getInstance(project).openFile(it, true) }
        notify(project, "Wrote ${file.path}. Review it, then run terraform init && terraform apply.")
    }
}

class RefreshAction : CndAction() {
    override fun actionPerformed(e: AnActionEvent) {
        CndSession.refresh()
        e.project?.let { CndBus.fire(it) }
    }
}
