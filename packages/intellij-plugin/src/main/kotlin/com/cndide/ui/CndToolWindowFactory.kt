package com.cndide.ui

import com.cndide.actions.TOOL_WINDOW
import com.cndide.gcp.CndProject
import com.cndide.gcp.CndSession
import com.cndide.gcp.GcpClient
import com.cndide.gcp.GcpService
import com.cndide.gcp.Pipeline
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.treeStructure.Tree
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.CardLayout
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.BoxLayout
import javax.swing.JButton
import javax.swing.JPanel
import javax.swing.tree.DefaultMutableTreeNode
import javax.swing.tree.DefaultTreeModel
import javax.swing.tree.TreePath

/**
 * Cloud Native Development tool window.
 * Sets NO fonts or colors: JBLabel, Tree, JButton and the action toolbar inherit the IDE's own UI font and theme.
 */
class CndToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = CloudPanel(project)
        val cnd = CndProject.get(project)
        val refresh = Runnable { panel.refresh() }
        cnd.listeners += refresh
        Disposer.register(toolWindow.disposable) { cnd.listeners.remove(refresh) }

        val group = DefaultActionGroup().apply {
            val am = ActionManager.getInstance()
            listOf("CND.SignIn", "CND.SelectProject", "CND.SwitchEnv", "CND.RunPipeline", "CND.Deploy", "CND.CreateResource", "CND.Refresh")
                .forEach { id -> am.getAction(id)?.let { add(it) } }
        }
        val toolbar = ActionManager.getInstance().createActionToolbar("CndToolWindow", group, true)
        toolbar.targetComponent = panel
        val root = JPanel(BorderLayout()).apply {
            add(toolbar.component, BorderLayout.NORTH)
            add(panel, BorderLayout.CENTER)
        }
        toolWindow.contentManager.addContent(ContentFactory.getInstance().createContent(root, "", false))
        CndSession.refresh()
        panel.refresh()
    }
}

private class EnvNode(val name: String, val active: Boolean) {
    override fun toString() = if (active) "$name  (active)" else name
}

private class InfoNode(val text: String) {
    override fun toString() = text
}

private class CloudPanel(private val project: Project) : JPanel(CardLayout()) {
    private val log = Logger.getInstance(CloudPanel::class.java)
    private val cnd = CndProject.get(project)

    private val account = JBLabel()
    private val projectLabel = JBLabel()
    private val envLabel = JBLabel()
    private val tree = Tree(DefaultTreeModel(DefaultMutableTreeNode("root"))).apply {
        isRootVisible = false
        showsRootHandles = true
    }

    private var loadToken = 0

    init {
        // Card 1: mode is off for this project
        val off = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            border = JBUI.Borders.empty(12)
            add(JBLabel("Cloud Native Development is off for this project."))
            add(JBLabel("Turn it on to connect to Google Cloud, run CI/CD pipelines,"))
            add(JBLabel("create cloud resources and deploy from this IDE."))
            add(javax.swing.Box.createVerticalStrut(JBUI.scale(10)))
            add(JButton("Enable Cloud Native Development").apply {
                addActionListener {
                    val action = ActionManager.getInstance().getAction("CND.Enable")
                    ActionManager.getInstance().tryToExecute(action, null, this, "CndToolWindow", true)
                }
            })
        }
        // Card 2: cloud native mode
        val header = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            border = JBUI.Borders.empty(4, 8)
            add(account)
            add(projectLabel)
            add(envLabel)
        }
        val on = JPanel(BorderLayout()).apply {
            add(header, BorderLayout.NORTH)
            add(JBScrollPane(tree), BorderLayout.CENTER)
        }
        add(off, "off")
        add(on, "on")

        tree.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (e.clickCount != 2) return
                val node = tree.lastSelectedPathComponent as? DefaultMutableTreeNode ?: return
                when (val o = node.userObject) {
                    is GcpService -> BrowserUtil.browse(o.consoleUrl)
                    is EnvNode -> cnd.update { env = o.name }
                }
            }
        })
    }

    fun refresh() {
        (layout as CardLayout).show(this, if (cnd.enabled) "on" else "off")
        if (!cnd.enabled) return

        account.text = "Account: " + (CndSession.account ?: "not signed in")
        projectLabel.text = "Project: " + cnd.projectId.ifBlank { "not selected" } + "   Region: ${cnd.region}"
        envLabel.text = "Environment: ${cnd.env}" + if (cnd.impersonate.isNotBlank()) "   Run as: ${cnd.impersonate.substringBefore('@')}" else ""

        val root = DefaultMutableTreeNode("root")
        val envs = DefaultMutableTreeNode("Environments")
        Pipeline.ENVS.forEach { envs.add(DefaultMutableTreeNode(EnvNode(it, it == cnd.env))) }
        root.add(envs)

        val pipe = DefaultMutableTreeNode("CI/CD")
        pipe.add(DefaultMutableTreeNode(InfoNode(if (Pipeline.hasPipeline(project.basePath)) "cloudbuild.yaml: ready" else "cloudbuild.yaml: not generated (right-click project > Cloud Native Dev)")))
        pipe.add(DefaultMutableTreeNode(InfoNode("Cloud Run service: ${cnd.envService}")))
        root.add(pipe)

        val services = DefaultMutableTreeNode("Services you can use")
        services.add(DefaultMutableTreeNode(InfoNode(
            when {
                !CndSession.signedIn -> "Sign in to list services"
                cnd.projectId.isBlank() -> "Select a project to list services"
                else -> "Loading…"
            },
        )))
        root.add(services)
        setModel(root)

        if (!CndSession.signedIn || cnd.projectId.isBlank()) return
        val token = ++loadToken
        val pid = cnd.projectId
        val sa = cnd.impersonate
        ApplicationManager.getApplication().executeOnPooledThread {
            val result = runCatching { GcpClient.services(pid, sa) }
            result.onFailure { log.warn("Listing services for $pid failed", it) }
            ApplicationManager.getApplication().invokeLater {
                if (token != loadToken) return@invokeLater
                services.removeAllChildren()
                result.onSuccess { list ->
                    if (list.isEmpty()) services.add(DefaultMutableTreeNode(InfoNode("No accessible services enabled in $pid")))
                    list.groupBy { it.category }.forEach { (cat, items) ->
                        val c = DefaultMutableTreeNode(cat)
                        items.forEach { c.add(DefaultMutableTreeNode(it)) }
                        services.add(c)
                    }
                }.onFailure { services.add(DefaultMutableTreeNode(InfoNode("Unable to list services: ${it.message}"))) }
                setModel(root)
            }
        }
    }

    private fun setModel(root: DefaultMutableTreeNode) {
        tree.model = DefaultTreeModel(root)
        // Expand every node (rowCount grows as rows expand, so re-check it each pass).
        var i = 0
        while (i < tree.rowCount) {
            tree.expandRow(i)
            i++
        }
        if (tree.rowCount > 0) tree.scrollPathToVisible(TreePath(root.path))
    }
}
