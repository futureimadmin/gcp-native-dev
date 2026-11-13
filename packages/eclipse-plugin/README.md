# Eclipse plugin

"Service Explorer" view (Window > Show View > Cloud Native Dev) with toolbar actions: Sign In, Select Project, Run As (impersonation), Bootstrap (writes Terraform), Refresh. Double-click a service to open it in the Google Cloud Console.

**Fonts:** the plugin sets none. The view uses stock SWT/JFace widgets, so it follows the fonts and theme of the Eclipse workbench.

## Build / run

Plug-in project (PDE): in Eclipse choose File > Import > Existing Projects, select `packages/eclipse-plugin`, then Run As > Eclipse Application. Requires Java 17 and the Google Cloud CLI (`gcloud`).

`com.cndide.eclipse.gcp.*` is plain Java (no Eclipse dependency) and compiles with `javac`. The view itself needs the Eclipse platform to compile; this has not been done here. No Tycho/Maven build or update site is set up yet.
