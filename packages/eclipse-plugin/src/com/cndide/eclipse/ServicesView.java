package com.cndide.eclipse;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.eclipse.core.runtime.IProgressMonitor;
import org.eclipse.core.runtime.IStatus;
import org.eclipse.core.runtime.Status;
import org.eclipse.core.runtime.jobs.Job;
import org.eclipse.jface.action.Action;
import org.eclipse.jface.action.IToolBarManager;
import org.eclipse.jface.dialogs.InputDialog;
import org.eclipse.jface.dialogs.MessageDialog;
import org.eclipse.jface.viewers.ArrayContentProvider;
import org.eclipse.jface.viewers.ITreeContentProvider;
import org.eclipse.jface.viewers.LabelProvider;
import org.eclipse.jface.viewers.TreeViewer;
import org.eclipse.jface.window.Window;
import org.eclipse.swt.SWT;
import org.eclipse.swt.widgets.Composite;
import org.eclipse.swt.widgets.Display;
import org.eclipse.ui.dialogs.ListDialog;
import org.eclipse.ui.part.ViewPart;
import org.eclipse.swt.program.Program;

import com.cndide.eclipse.gcp.GcpClient;
import com.cndide.eclipse.gcp.GcpClient.Project;
import com.cndide.eclipse.gcp.GcpClient.Service;

/**
 * Service Explorer view. Uses only stock SWT/JFace widgets and never sets a font or color,
 * so the tree uses the fonts and theme configured in the Eclipse workbench.
 */
public class ServicesView extends ViewPart {
    private TreeViewer viewer;
    private String projectId = "";
    private String impersonate = "";

    private static final class Category {
        final String name;
        final List<Service> services = new ArrayList<>();

        Category(String name) {
            this.name = name;
        }

        @Override
        public String toString() {
            return name + " (" + services.size() + ")";
        }
    }

    @Override
    public void createPartControl(Composite parent) {
        viewer = new TreeViewer(parent, SWT.SINGLE | SWT.V_SCROLL | SWT.H_SCROLL);
        viewer.setContentProvider(new ITreeContentProvider() {
            @Override public Object[] getElements(Object input) { return ArrayContentProvider.getInstance().getElements(input); }
            @Override public Object[] getChildren(Object p) { return p instanceof Category c ? c.services.toArray() : new Object[0]; }
            @Override public Object getParent(Object e) { return null; }
            @Override public boolean hasChildren(Object e) { return e instanceof Category; }
        });
        viewer.setLabelProvider(new LabelProvider());
        viewer.addDoubleClickListener(e -> {
            Object sel = viewer.getStructuredSelection().getFirstElement();
            if (sel instanceof Service s) Program.launch(s.consoleUrl());
        });
        show(List.of("Use the toolbar: Sign In, then Select Project"));

        IToolBarManager tb = getViewSite().getActionBars().getToolBarManager();
        tb.add(new Action("Sign In") { @Override public void run() { signIn(); } });
        tb.add(new Action("Select Project") { @Override public void run() { selectProject(); } });
        tb.add(new Action("Run As") { @Override public void run() { runAs(); } });
        tb.add(new Action("Bootstrap") { @Override public void run() { bootstrap(); } });
        tb.add(new Action("Refresh") { @Override public void run() { refresh(); } });
    }

    @Override
    public void setFocus() {
        viewer.getControl().setFocus();
    }

    private void show(List<?> input) {
        if (viewer.getControl().isDisposed()) return;
        viewer.setInput(input);
        viewer.expandAll();
    }

    private void ui(Runnable r) {
        Display.getDefault().asyncExec(() -> { if (!viewer.getControl().isDisposed()) r.run(); });
    }

    private void job(String name, ThrowingRunnable work) {
        new Job(name) {
            @Override
            protected IStatus run(IProgressMonitor monitor) {
                try {
                    work.run();
                } catch (Exception e) {
                    ui(() -> MessageDialog.openError(viewer.getControl().getShell(), "Cloud Native Dev", String.valueOf(e.getMessage())));
                }
                return Status.OK_STATUS;
            }
        }.schedule();
    }

    @FunctionalInterface
    private interface ThrowingRunnable { void run() throws Exception; }

    private void signIn() {
        job("Signing in to Google Cloud", () -> {
            new ProcessBuilder(GcpClient.gcloud(), "auth", "login").inheritIO().start().waitFor();
            ui(this::refresh);
        });
    }

    private void selectProject() {
        job("Listing projects", () -> {
            List<Project> list = GcpClient.projects(impersonate);
            ui(() -> {
                ListDialog d = new ListDialog(viewer.getControl().getShell());
                d.setTitle("Select Project");
                d.setMessage("Select the active Google Cloud project");
                d.setContentProvider(ArrayContentProvider.getInstance());
                d.setLabelProvider(new LabelProvider() {
                    @Override public String getText(Object o) { return ((Project) o).id() + " — " + ((Project) o).name(); }
                });
                d.setInput(list);
                if (d.open() == Window.OK && d.getResult().length > 0) {
                    projectId = ((Project) d.getResult()[0]).id();
                    refresh();
                }
            });
        });
    }

    private void runAs() {
        if (projectId.isEmpty()) {
            MessageDialog.openWarning(viewer.getControl().getShell(), "Cloud Native Dev", "Select a project first.");
            return;
        }
        ListDialog d = new ListDialog(viewer.getControl().getShell());
        d.setTitle("Run as");
        d.setMessage("Choose the identity to use");
        d.setContentProvider(ArrayContentProvider.getInstance());
        d.setLabelProvider(new LabelProvider());
        String suffix = "@" + projectId + ".iam.gserviceaccount.com";
        d.setInput(new String[] {"My user credentials", "cnd-dev-sa" + suffix, "cnd-cicd-sa" + suffix, "cnd-obs-sa" + suffix});
        if (d.open() != Window.OK || d.getResult().length == 0) return;
        String choice = (String) d.getResult()[0];
        String target = choice.startsWith("My ") ? "" : choice;
        job("Validating impersonation", () -> {
            GcpClient.projects(target); // fails fast if impersonation is denied
            impersonate = target;
            ui(this::refresh);
        });
    }

    private void bootstrap() {
        InputDialog in = new InputDialog(viewer.getControl().getShell(), "Bootstrap Environments", "Project id to bootstrap:", projectId, null);
        if (in.open() != Window.OK || in.getValue().isBlank()) return;
        String id = in.getValue().trim();
        String ws = System.getProperty("user.dir");
        InputDialog dir = new InputDialog(viewer.getControl().getShell(), "Bootstrap Environments",
                "Folder to write infra/cnd-bootstrap/gcp/main.tf into (nothing is applied to your cloud account):", ws, null);
        if (dir.open() != Window.OK || dir.getValue().isBlank()) return;
        job("Writing Terraform", () -> {
            Path target = Path.of(dir.getValue().trim(), "infra", "cnd-bootstrap", "gcp", "main.tf");
            GcpClient.writeFile(target, GcpClient.terraform(id, List.of("dev", "sit", "uat", "prod"), "us-central1"));
            ui(() -> MessageDialog.openInformation(viewer.getControl().getShell(), "Cloud Native Dev",
                    "Wrote " + target + "\nReview it, then run terraform init && terraform apply."));
        });
    }

    private void refresh() {
        if (projectId.isEmpty()) {
            show(List.of("No project selected"));
            return;
        }
        setContentDescription("Project: " + projectId + (impersonate.isEmpty() ? "" : " (as " + impersonate.substring(0, impersonate.indexOf('@')) + ")"));
        show(List.of("Loading…"));
        final String pid = projectId;
        final String as = impersonate;
        job("Loading services", () -> {
            List<Service> services = GcpClient.services(pid, as);
            Map<String, Category> by = new LinkedHashMap<>();
            for (Service s : services) by.computeIfAbsent(s.category(), Category::new).services.add(s);
            ui(() -> show(by.isEmpty() ? List.of("No accessible services in this project") : new ArrayList<>(by.values())));
        });
    }
}
