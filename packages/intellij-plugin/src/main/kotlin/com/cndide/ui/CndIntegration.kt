package com.cndide.ui

import com.cndide.actions.Flows
import com.cndide.actions.TOOL_WINDOW
import com.cndide.gcp.CndProject
import com.cndide.gcp.CndSession
import com.cndide.gcp.Pipeline
import com.intellij.ide.projectView.PresentationData
import com.intellij.ide.projectView.ProjectViewNode
import com.intellij.ide.projectView.ProjectViewNodeDecorator
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.openapi.util.io.FileUtil
import com.intellij.openapi.wm.StatusBar
import com.intellij.openapi.wm.StatusBarWidget
import com.intellij.openapi.wm.StatusBarWidgetFactory
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.ui.SimpleTextAttributes
import com.intellij.util.Consumer
import java.awt.event.MouseEvent

/** Empty host window; each command run adds its own console tab. */
class CndConsoleFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {}
}

/** On startup: refresh sign-in state and open the Cloud Native tool window if the project is in Cloud Native mode. */
class CndStartup : ProjectActivity {
    override suspend fun execute(project: Project) {
        CndSession.refresh()
        if (CndProject.get(project).enabled) {
            ApplicationManager.getApplication().invokeLater {
                if (!project.isDisposed) ToolWindowManager.getInstance(project).getToolWindow(TOOL_WINDOW)?.show()
            }
        }
    }
}

/** Marks the project root in the Project view: "my-app  ☁ gcp-project · dev" */
class CndNodeDecorator : ProjectViewNodeDecorator {
    override fun decorate(node: ProjectViewNode<*>, data: PresentationData) {
        val project = node.project ?: return
        val cnd = CndProject.get(project)
        if (!cnd.enabled) return
        val base = project.basePath ?: return
        val vf = node.virtualFile ?: return
        if (!FileUtil.pathsEqual(vf.path, base)) return
        if (data.coloredText.isEmpty()) data.addText(data.presentableText ?: node.name ?: project.name, SimpleTextAttributes.REGULAR_ATTRIBUTES)
        data.addText("  ☁ ${cnd.projectId.ifBlank { "no project" }} · ${cnd.env}", SimpleTextAttributes.GRAYED_ATTRIBUTES)
    }

    override fun decorate(node: com.intellij.packageDependencies.ui.PackageDependenciesNode, cellRenderer: com.intellij.ui.ColoredTreeCellRenderer) {}
}

/** Status bar: "☁ project · env". Click to switch environment. Shown only in Cloud Native mode. */
class CndStatusWidgetFactory : StatusBarWidgetFactory {
    override fun getId() = ID
    override fun getDisplayName() = "Cloud Native Development"
    override fun isAvailable(project: Project) = CndProject.get(project).enabled
    override fun createWidget(project: Project): StatusBarWidget = CndStatusWidget(project)
    override fun canBeEnabledOn(statusBar: StatusBar) = true

    companion object {
        const val ID = "CndStatusWidget"
    }
}

private class CndStatusWidget(private val project: Project) : StatusBarWidget, StatusBarWidget.TextPresentation {
    private var bar: StatusBar? = null
    private val cnd = CndProject.get(project)
    private val listener = Runnable { bar?.updateWidget(CndStatusWidgetFactory.ID) }

    override fun ID() = CndStatusWidgetFactory.ID
    override fun getPresentation() = this

    override fun install(statusBar: StatusBar) {
        bar = statusBar
        cnd.listeners += listener
    }

    override fun dispose() {
        cnd.listeners.remove(listener)
        bar = null
    }

    override fun getText(): String {
        val who = if (CndSession.signedIn) cnd.projectId.ifBlank { "select project" } else "signed out"
        return "☁ $who · ${cnd.env}"
    }

    override fun getAlignment() = 0f
    override fun getTooltipText() = "Cloud Native Development: click to switch environment"

    override fun getClickConsumer(): Consumer<MouseEvent> = Consumer {
        JBPopupFactory.getInstance().createPopupChooserBuilder(Pipeline.ENVS)
            .setTitle("Environment")
            .setItemChosenCallback { env -> cnd.update { this.env = env } }
            .createPopup().showInCenterOf(bar?.component ?: return@Consumer)
    }
}
