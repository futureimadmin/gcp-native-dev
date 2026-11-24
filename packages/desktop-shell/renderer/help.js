/* Built-in Help. Everything is local and explanatory: no network, no links out. Opens as a tab. */
'use strict';

const P = (text) => ['p', text];
const UL = (...items) => ['ul', items];
const H2 = (text) => ['h2', text];

const HELP = [
  { id: 'start', title: 'Getting started', body: [
    ['h1', 'Getting started'],
    P('Nativity Studio is an IDE for building applications and running them on Google Cloud, AWS, Azure and private clouds (Kubernetes). It combines an editor, a build/run/debug toolbar, cloud connections, AI assistants and migration tools in one window.'),
    H2('What happens when it starts'),
    UL('The IDE looks for Google Cloud Application Default Credentials (ADC). If none exist it offers to sign you in; if they exist it shows the project stored in them.',
      'AWS, Azure and Kubernetes are checked in the background. Each cloud you are signed in to appears as a coloured dot in the toolbar.',
      'The first screen is the Workspace: create a project, open a folder, import from GitHub, or pick a recent project.'),
    H2('A first session'),
    UL('File > New Project. The first entry, Cloud Native Project, is the recommended start: pick a stack, a cloud and the environments (you work in the first, the others are deployment targets). The IDE creates the code with a Dockerfile and a GitHub Actions pipeline that builds once and promotes the same image through the environments, binds the project to the cloud, and opens the cloud set-up. Nothing is created in the cloud until you press Provision. The other entries are plain templates (for example Spring Boot or React).',
      'Press the green Run button (or F5). The IDE detected how the project builds; the Run configuration box in the toolbar shows what it found.',
      'Open the Clouds view, sign in, and pick a project or account. Services you may use are listed; click one to open it inside the IDE.',
      'Right-click the project folder > Enable Cloud Native Development to deploy and run pipelines.'),
    H2('Layout'),
    P('Every panel can be resized by dragging the thin bar between it and its neighbour (double-click the bar to reset). The bottom panel can be maximised, restored or minimised from its title bar. Clicking the active icon in the left bar hides the sidebar. Double-click an editor tab, or press Ctrl+K then Z, for focus mode; Esc leaves it.'),
  ] },

  { id: 'workspace', title: 'Workspace & editor', body: [
    ['h1', 'Workspace and editor'],
    P('The Workspace tab is the home page of the IDE. It stays open next to your files. The Explorer shows the project folder; right-click for new file/folder, rename and delete (deleted items go to the Recycle Bin).'),
    H2('Editing'),
    UL('The editor is Monaco (the engine behind VS Code): syntax colouring for most languages, multi-cursor, find/replace, code folding and a minimap.',
      'Fonts follow NetBeans defaults: Segoe UI for the interface and Monospaced for code.',
      'Auto-save: files save about a second after you stop typing, and when the window loses focus. Change this in Settings > General (After delay, On focus loss, Off).',
      'Projects: the IDE reads build files (pom.xml, Gradle, Ant) and treats each project as its own module with its own source folders, Java level and dependencies, so a folder holding many unrelated projects (a monorepo) works. Run > Show Detected Projects lists what it found.',
      'Java has a built-in compiler (the JDK javac, no Maven or Gradle needed). After you save, and after you pause typing for 5 or 10 seconds (your choice in Settings > General), the file you edited is checked inside its own module, including unsaved text. A problem shows as a small red dot in the margin; hover it to read the message. Every problem is listed in the PROBLEMS tab with file, line and message; click a row to open the file at that line.',
      'Build (Ctrl+F9) compiles the whole module of the active file and prints the result in OUTPUT. Maven dependencies are resolved once per project and cached in the IDE data folder, never in your project.',
      'Find a file in the tree: the path bar above the editor shows where the open file lives; click any part of it, or press Alt+Shift+L (or right-click a tab > Reveal in Explorer), to jump to it in the Explorer. The Explorer follows the open tab by default; the arrows button in the Explorer header turns that off.'),
    H2('Bottom panel'),
    P('TERMINAL runs commands in your project folder (it is a command runner, not a full terminal emulator; Claude Code runs in the AI panel). OUTPUT shows build and test results with clickable error lines; PROBLEMS lists compile errors and warnings.'),
  ] },

  { id: 'projects', title: 'Languages & frameworks', body: [
    ['h1', 'Languages and frameworks'],
    P('The IDE is language-agnostic. It edits any text file and detects the build system of a folder to decide how to compile, run, test and debug it.'),
    H2('Detected automatically'),
    UL('Maven and Gradle: Java, Spring Boot, Quarkus, Tomcat WARs.',
      'npm / pnpm / yarn: React, Angular, Vue, Svelte, Next.js, Node.js services, TypeScript.',
      'Python: pip projects, FastAPI, Django, plain scripts.', 'Go modules.', '.NET projects.'),
    H2('New Project templates'),
    UL('Java: console app (Maven), Spring Boot REST service, Quarkus REST service, WAR for Apache Tomcat.',
      'Web: React (Vite), Vue (Vite), Angular (generated by the official Angular CLI), static site.',
      'Services: Node.js (Express), Python (FastAPI), Go, .NET Web API (generated by the .NET SDK).',
      'Cloud: AWS Lambda (SAM), Azure Functions, plus container-ready services for Cloud Run, ECS, Container Apps and Kubernetes.',
      'More templates can be added by plugins.'),
    P('Templates that use a framework generator (Angular, .NET) run the official command in the terminal panel and open the project when it finishes. They need internet access and the matching runtime.'),
  ] },

  { id: 'run', title: 'Build, run & debug', body: [
    ['h1', 'Build, run and debug'],
    P('The toolbar has a Run configuration list (the detected build environments in your project) and four buttons: Build, Run, Debug and Stop. The Run menu has the same actions with keyboard shortcuts: Ctrl+F9 build, F5 run, Ctrl+F5 debug, Shift+F5 stop.'),
    H2('Run & Servers view'),
    P('The ▶ icon in the left bar lists every detected project with its tasks (install, compile, package, test, run, debug), the runtimes found on this computer, Apache Tomcat controls and every server listening on a local port.'),
    H2('How Debug works today'),
    P('Debug starts your application with the standard debug agent switched on and tells you its port: Java uses JDWP on 5005 (Spring Boot, Quarkus, plain Maven/Gradle), Node.js uses the inspector on 9229, Python uses debugpy on 5678, Go uses Delve on 2345 and Tomcat uses 8000. Attach with the debugger of your choice (for example Remote JVM Debug in IntelliJ, Eclipse or VS Code). A step debugger with breakpoints inside this IDE is planned but is not available yet.'),
    H2('Why a task may be greyed out'),
    P('The tool it needs (Maven, Node.js, Python...) was not found. Open Settings > Runtimes and point the IDE at the install folder, or install the tool and press the refresh icon in the Run & Servers view.'),
  ] },

  { id: 'servers', title: 'Local servers & Tomcat', body: [
    ['h1', 'Local servers and Tomcat'],
    H2('Apache Tomcat'),
    UL('Set the Tomcat folder (the one with bin/catalina) in Settings > Runtimes; the IDE also looks in common install locations.',
      'Start runs Tomcat in the terminal panel; Debug starts it with a JPDA debug port on 8000; Stop shuts it down.',
      'For a WAR project use "Package and deploy to Tomcat": the IDE builds the project, copies the .war into webapps and opens the application in the IDE browser.',
      'The Servlet template uses the Jakarta namespace, which needs Tomcat 10.1 or newer.'),
    H2('Servers already running'),
    P('The Run & Servers view lists everything listening on this computer. Click a port to open http://localhost:port in an IDE browser tab. This works for any HTTP server: Tomcat, Spring Boot, Vite, a database admin page, a container you started with Docker.'),
    H2('The IDE browser'),
    P('Pages open in an editor tab with back, forward, reload and an address bar. It only opens https addresses and localhost. Cloud provider consoles are not shown there: their sign-in pages refuse embedded browsers, which is why services open in the IDE explorer instead.'),
  ] },

  { id: 'clouds', title: 'Clouds & services', body: [
    ['h1', 'Clouds and services'],
    P('You can be signed in to several clouds at the same time. Each uses its own official command-line tool, and the IDE never sees your passwords.'),
    UL('Google Cloud: Application Default Credentials and the gcloud CLI.', 'AWS: CLI profiles and IAM Identity Center (SSO).', 'Azure: az login and subscriptions.', 'Private clouds: any Kubernetes context in your kubeconfig (OpenShift, Tanzu, Rancher, EKS, GKE, AKS, kind, Docker Desktop).'),
    H2('Least privilege'),
    P('The service list shows only what your identity is allowed to use. Services you cannot access are hidden rather than shown with errors.'),
    H2('Working with services inside the IDE'),
    P('Click a service (for example Cloud Run) in the Clouds view. A tab opens in the workspace listing your resources of that type with their region and status. Select one to see its full configuration, read its logs, open the running application in the IDE browser, copy its name or ask the AI assistant to review it. For a Cloud Storage bucket the tab also lets you browse its folders and files (sizes and dates, a path bar to go up) and preview the first 64 KB of text files. These actions are read-only: nothing changes in your cloud.'),
    P('Resource lists exist for Cloud Run, Cloud Functions, GKE, Cloud Storage, Cloud SQL, Secret Manager (names only), Artifact Registry, Cloud Build and Pub/Sub. Other services show a short note and a button that opens the provider console in your normal browser.'),
  ] },

  { id: 'scm', title: 'Source control (Git)', body: [
    ['h1', 'Source control'],
    P('The SOURCE CONTROL section sits under the Explorer (drag the bar between them to resize, click a title to collapse it). It works with every Git host: GitHub, GitLab, Bitbucket, Azure DevOps, Gitea / Forgejo / Codeberg and your own server. The host is recognised from the remote address and only changes the logo and the web links.'),
    H2('Everyday work'),
    UL('Changes are listed as Staged, Changes and Merge conflicts. Click a file to see the difference, + to stage, − to unstage, ↶ to discard. Right-click a file for more (history, ignore, accept ours / theirs).',
      'Write a message and press Commit (Ctrl+Enter). Tick Amend last commit to change the last commit instead of adding one: its message is filled in and staged changes are added to it. Commit & Push does both; an amended commit that was already pushed is force-pushed safely (with lease) after you confirm.',
      'Fetch, Pull, Push and Sync are in the toolbar; the ⋯ menu has pull with rebase, push tags, force push, branches, tags, stash, remotes, history and Open on host (repository, branch, commits, new pull / merge request, issues, CI).',
      'The branch chip switches or creates branches, and shows how many commits you are ahead or behind. The status bar shows it too.'),
    H2('More'),
    UL('Explorer files are coloured by status (modified, new, deleted, conflict) and the editor margin marks changed lines against the last commit (green new, blue changed, red deleted).',
      'Branches (switch, merge, rebase, delete), Tags, Stash, Remotes and History (also per file) open from the ⋯ menu or the command palette ("Source Control: …"). Click a commit to see its files and each file\u2019s changes; right-click it to cherry-pick, revert, reset, branch or tag.',
      'Clone works for any address (File > Clone Git Repository). It shows the host, can check the address and list branches first, supports a shallow clone and submodules, and opens the project when it finishes.',
      'No repository yet: Initialize one, or Publish to a host (choose the host, create an empty repository there, paste its address).'),
    P('Sign-in is done by Git itself: Git Credential Manager (a sign-in window may appear for HTTPS) or your SSH key. The IDE never sees your password or token. Mercurial and Subversion are not covered.'),
  ] },

  { id: 'build', title: 'Build tools', body: [
    ['h1', 'Build tools'],
    P('The BUILD section (under Source Control) finds every build file in the project, monorepos included, and lets you pick which one to work on: Maven, Gradle, Ant, npm / Yarn / pnpm / Bun, pip / Poetry / uv, Go, Cargo, .NET, Make, CMake, Composer, Bundler, Flutter, sbt and Bazel.'),
    UL('Recommended goals are buttons (for Maven: clean install, clean package, test, plus run goals for the plugins your pom uses, such as spring-boot:run or quarkus:dev); ALL GOALS lists the rest, grouped. npm shows every script from package.json.',
      'Tick options such as Skip tests, Offline, Update snapshots, Parallel; choose Maven profiles and a module (with its dependencies). Type your own goals in the box, press Enter, and star the ones you want to keep.',
      'Output goes to the OUTPUT panel: errors and warnings that name a file and line are clickable, Stop ends the build, and a result card shows the time and the error count with Run again.',
      'PROJECT, DEPENDENCIES, MODULES and PLUGINS come from your build file. + Add searches Maven Central (or npm, PyPI, crates.io, NuGet, Packagist) and edits pom.xml / build.gradle, or installs the package with the tool. ✕ removes one. Tree, Outdated and Analyze / Audit run the tool\u2019s own report.',
      'If the tool is not installed the section says so and Set up… opens Settings > Runtimes. Projects with a wrapper (mvnw, gradlew) use it unless you untick wrapper.'),
    P('Command palette: Build: Run Goal…, Run Again, Stop, Run Custom Goals…, Add Dependency…'),
  ] },

  { id: 'gcpwizard', title: 'Google Cloud set-up wizard', body: [
    ['h1', 'Google Cloud set-up wizard'],
    P('In Google Cloud an environment is a folder, and folders live inside an organization, so the set-up is done once for the whole organization and then shared by every application. Enable Cloud Native Development (or use the project menu: Google Cloud set-up wizard) and the wizard walks you through it.'),
    UL('1 Organization: your organizations are listed; pick one (or type its id). The IDE shows what is already there and reuses it. With no organization (a personal Google account) you can continue without folders: projects are created side by side and labelled with their tier.',
      '2 Environments: every environment is a folder in the organization, of type Standard (dev, sit …) or Compliant (uat, preprod, prod …; created with Assured Workloads, with a compliance package you choose). Name the environments, switch any between the two types, mark any protected. Optional guardrails (organization policies) are applied to the folders and inherited by every project.',
      '3 Billing: choose the billing account for each tier. Projects are created with it linked.',
      '4 Applications: every application found in the workspace is listed (add more by folder). For each one choose: its own project in every environment folder (default), one shared project per environment, or projects that already exist. For existing projects you choose, per application or for all at once: Prepare it (APIs, registry, new cnd-* service accounts and their roles), Give me access (Viewer + impersonation), Move it into the environment folder (off by default: the project then inherits the folder\u2019s roles and organization policies). All off = just link. Nothing already in a project (roles, custom roles, service accounts) is ever removed or replaced. Select all, then apply one choice to all selected at once. Provision builds the topology only (folders, projects, service accounts, roles, registries). It deploys no workload: Cloud Run, GKE, Cloud Storage or S3 uploads and Lambda are deployed separately from the IDE after the code is written. For an existing application from GitHub or another host, deploy it into the first environment yourself and let your CI/CD pipeline promote it through SIT, UAT and the rest.',
      '5 Review: the folder and project tree as a diagram, who can do what, and every command. Nothing is created yet.',
      '6 Provision: runs the steps one at a time with live progress; steps for things that exist are skipped, so it is safe to run again. A failure in one environment or application does not stop the others.'),
    P('Each project gets its APIs, an Artifact Registry repository, and deployer, runtime and pipeline service accounts with only the roles they need. You get read-only access and the right to impersonate the deployer account, so the IDE runs gcloud as that account: no keys.'),
    P('The result is saved in .nativity/project.json: the landing zone, and for each application and environment the project it lives in. The Clouds view then has an Application selector next to Environment; switching either switches project and the impersonated account. Opening a file of an application selects that application automatically. Later, open another application and choose "Associate applications with Google Cloud projects…": the wizard starts at step 4 and reuses the landing zone.'),
    P('You need, on the organization: Folder Creator (or Folder Admin) and Project Creator, and Billing Account User on the billing account. Guardrails also need Organization Policy Administrator; without it those steps are skipped with a warning.'),
  ] },

  { id: 'envs', title: 'Environments & architecture', body: [
    ['h1', 'Environments and architecture'],
    P('Enable Cloud Native Development (project menu, or the Clouds view). If no cloud is connected the IDE asks you to connect one first. Then the Cloud Native Architecture page opens: choose how many environments you want and what to call them (dev, sit, uat, prod, or qa, staging, live ... up to 8), and see how they will be built in every cloud you are connected to. Nothing is created until you press Provision.'),
    H2('What is built in each cloud'),
    UL('Google Cloud has its own set-up wizard (see "Google Cloud set-up wizard"): one folder per environment (type Standard or Compliant) directly in the organization, and a project per application and environment inside it. Details: one project per environment is the isolation boundary. Each project gets its APIs, an Artifact Registry repository and three service accounts (deployer, runtime, pipeline) with only the roles they need. You get read-only access and the right to impersonate the deployer account, so the IDE runs gcloud as that account: no keys, every change is audited. Without an organization (a personal Google account) there are no folders, so the projects are created side by side and labelled.',
      'AWS: one CloudFormation stack per environment from a single template (written to infra/cnd-environments/aws): container registry, private encrypted bucket, log group, a runtime role and a deployer role that you assume for short-lived credentials. Protected environments get immutable image tags, versioned data, longer logs and termination protection.',
      'Azure: one resource group per environment from a single Bicep template: Container Apps environment, Log Analytics, Container Registry, Key Vault and two managed identities. Access is granted on the resource group (Contributor on dev-like, Reader on protected), so a mistake in dev cannot reach prod.',
      'Kubernetes: one namespace per environment with resource quota, default limits, default-deny network policy, Pod Security level and a namespace-only deployer service account.'),
    H2('Protected environments'),
    P('Mark any environment protected (prod is by default). Protected environments get the stricter settings above, you get read-only access, and Provision (and later cloud-changing actions) asks you to type a word first.'),
    H2('Provisioning'),
    P('Show every step and command lists exactly what will run. Provision runs the steps one at a time with live progress; steps for things that already exist are skipped, so you can run it again to add an environment or repair a failure. A failure in one environment does not stop the others. The result is saved in .nativity/project.json (and a log of the run in .nativity/logs), and switching environment then switches project, account or resource group and the impersonated identity with it. Save a copy of the plan writes it to docs/environments for review.'),
    P('You need permission to create these things (for Google Cloud: Folder Creator, Project Creator and Billing Account User; for Azure: Owner on the subscription, because role assignments are created; for AWS: rights to create IAM roles and CloudFormation stacks). The page lists what is needed for each cloud.'),
  ] },

  { id: 'cnmode', title: 'Cloud Native mode & CI/CD', body: [
    ['h1', 'Cloud Native Development mode'],
    P('Right-click a project and choose Enable Cloud Native Development to bind it to a cloud, a project or account, an environment (dev, sit, uat, prod) and a service name. The toolbar and status bar then show the cloud and environment, and CI/CD, Deploy and Create Resource become available.'),
    H2('Safety model'),
    UL('The IDE prepares the exact command and shows it to you in full before anything runs.',
      'A command can only be run if the IDE itself prepared it; the user interface cannot submit arbitrary text for execution.',
      'Production needs you to type the word prod to confirm.'),
    H2('What you can do'),
    UL('Generate a pipeline file (Cloud Build, CodeBuild or Azure Pipelines style) from the project.', 'Run the pipeline or deploy directly.', 'Create cloud resources such as buckets, queues or registries.', 'Generate Terraform for dev, sit, uat and prod environments.'),
  ] },

  { id: 'ai', title: 'AI assistants', body: [
    ['h1', 'AI assistants'],
    P('Open the assistant with the ✦ AI button. Choose a provider at the top. Attach the current file, your selection or the migration analysis; you review what will be sent before pressing Send.'),
    H2('Sign-in providers (no API key)'),
    UL('Claude Code: uses the Claude Code command-line tool installed on this computer, signed in with a Claude subscription or Console account. If it is not signed in, press Sign in; a console window opens for the login.',
      'Gemini (Google Cloud): uses the same Application Default Credentials as the Google Cloud connection and calls Vertex AI in your project. Your project needs the Vertex AI API enabled and the Vertex AI User role. Gemini (API key) uses a key from aistudio.google.com. Models are coloured: green = the Gemini API has a free tier for it, orange = paid only; through Google Cloud everything is billed to your project.'),
    H2('API-key providers'),
    P('Claude, Gemini, Grok and any OpenAI-compatible endpoint can also be used with an API key. Keys are encrypted with the Windows keystore and never shown again. Pointing the OpenAI-compatible option at a local server such as Ollama keeps your code on this computer.'),
    H2('Claude Code inside the IDE'),
    P('Choose "Claude Code" in the AI panel. It runs in this window (no console window), keeps the conversation going between messages, streams the answer as it is written and shows each tool it uses (for example Read or Grep). By default it can read your project but not change it. Tick "Allow Claude to edit files in this project" to let it make edits; the Explorer and any open, unmodified files refresh when it finishes. Use Git so you can review and undo changes. Press Stop to cancel a running answer, and New chat to start a fresh session.'),
    H2('Other terminal agents'),
    P('Gemini CLI and Codex CLI are full-screen terminal programs and still open in their own console window from the AI menu. Claude Code no longer does.'),
  ] },

  { id: 'modernize', title: 'Modernize & migrate', body: [
    ['h1', 'Modernize and migrate'],
    P('Modernize scans the open project and finds frameworks, databases, queues, SDKs and configuration. It then proposes a target service on the cloud you choose and one of the six common migration strategies per component: rehost, replatform, refactor, repurchase, retire or retain.'),
    UL('Assess shows findings with a severity.', 'Generate Migration Plan writes a phased plan to docs/migration in your project.', 'Ask AI to refine sends the analysis to the assistant you pick, after you review it.'),
  ] },

  { id: 'runtimes', title: 'Runtimes', body: [
    ['h1', 'Runtimes'],
    P('Settings > Runtimes lists the tools the IDE can use: Node.js, Java (JDK), Maven, Gradle, Python, Go, .NET, Git, Docker and Apache Tomcat. For each one it shows the version found on this computer.'),
    UL('Browse sets an install folder to use instead of the default one on your PATH. For example, choose a different JDK; the IDE sets JAVA_HOME and puts its bin folder first.',
      'Reset returns to what the system provides.', 'The IDE also adds common install folders (such as the Claude Code and npm folders) to its PATH, so tools you can run in a terminal are found here too.'),
  ] },

  { id: 'plugins', title: 'Plugin development', body: [
    ['h1', 'Plugin development guide'],
    P('Almost everything in the IDE is a plugin: the Google Cloud, AWS, Azure and Kubernetes connectors, the AI providers, the project templates and Modernize. You can add your own.'),
    H2('Anatomy of a plugin'),
    UL('A folder with a plugin.json manifest (id, name, version, description, and the files it uses).', 'main.js runs in the main process and exports activate(ctx).', 'renderer.js runs in the user interface and calls CNS.plugin(id, api).'),
    H2('What a plugin can add'),
    UL('A cloud: sign-in, scope list, inventory, resource explorer and optional pipeline/deploy/resource commands.', 'An AI provider (with an API key or sign-in) or a terminal agent.', 'Project templates and analyzers.', 'Sidebar views, commands, toolbar buttons and menu items.'),
    H2('Safety rules for plugins'),
    UL('A cloud provider only builds command text; the IDE shows it and runs it after confirmation.', 'Validate every value and build commands with ctx.commandLine, which rejects unsafe characters.', 'Build the interface with DOM calls and textContent, never innerHTML; the page has a strict Content-Security-Policy.'),
    H2('Installing and trust'),
    P('Put the plugin folder in the plugins folder (Settings > Plugins > Open plugins folder) and enable it in Settings. Third-party plugins run with the same access as you, so they stay disabled until you accept a warning. Restart the IDE to apply.'),
    P('A complete reference of the main-process API (ctx.cloud, ctx.ai, ctx.templates, ctx.analyzers, ctx.ipc, ctx.exec, ctx.settings, ctx.secrets) and the renderer API (views, commands, toolbar, ui helpers) is in docs/PLUGINS.md in the IDE installation folder, with a VMware vSphere skeleton under examples/.'),
  ] },

  { id: 'nativity', title: 'The .nativity folder & Markdown', body: [
    ['h1', 'The .nativity folder'],
    P('Like IntelliJ\u2019s .idea or VS Code\u2019s .vscode, Nativity Studio keeps its own files for a project in a folder named .nativity inside it. The IDE creates it when you open a folder (and recreates it if you delete it). It contains:'),
    UL('project.json: the Cloud Native binding: the cloud, your environments (any names) and where each one lives (project IDs, resource groups, stack names, namespaces). No secrets. Commit this file so teammates open the project already connected.',
      'workspace.json: your personal session: the files that were open (they reopen next time), the build you last selected with its favourites and history, and advisor tips you switched off for this project. Not committed.',
      'logs/: one log per environment provisioning run (what was created, when, what failed). Not committed.',
      'README.md and .gitignore: explain the folder and keep the personal parts out of Git.'),
    P('Not stored there: caches (compiled classes, dependency classpaths, indexes), which live in the IDE\u2019s app-data folder so projects stay clean, and sign-ins or API keys, which are never written into a project. Projects from older versions (.cnd/project.json) are brought across automatically.'),
    ['h1', 'Markdown files'],
    P('A Markdown file (.md) opens in the editor with a switch in the top-right corner: Edit (the text), Preview (the rendered page) and Split (both side by side, scrolling together and updating as you type). Ctrl+Shift+V toggles Edit / Preview. The choice is remembered for the file and used for the next one.'),
    P('The preview shows headings, lists (nested and task lists), tables, quotes, code blocks with colours and a copy button, links (web links open in your browser, links to other files open in the IDE, #links jump within the page) and pictures stored in the project. Pictures from the web are not loaded, and HTML inside the Markdown is shown as text, so a document can never run anything.'),
  ] },

  { id: 'java', title: 'Java & code editing', body: [
    ['h1', 'Java and code editing'],
    P('For Maven and Gradle projects (and Ant-style src folders) the Explorer shows Source Packages, Resources, Web Pages, Test Packages and Test Resources at the top, and shows packages as dotted names such as com.example.app instead of nested folders.'),
    H2('Completion (Ctrl+Space)'),
    P('Java completion is based on your project and the most-used JDK classes, so the list is short and relevant: after a dot you see only the members of that expression (variables, method results, this, new X(), String literals, System.out). Without a dot you see local variables, members of the current class, matching class names (type capitals such as HM for HashMap) and a few snippets such as sout, fori and psvm. Choosing a class adds its import automatically.'),
    H2('Finding things'),
    UL('Ctrl+F finds in the file; Ctrl+H finds and replaces. Ctrl+Shift+F searches the whole project, Ctrl+Shift+H replaces across files (you confirm first).',
      'Ctrl+P goes to a file by name. Ctrl+Shift+T opens a Java class (type HM for HashMap-style names). Ctrl+T goes to any class, method or field in the project.',
      'Ctrl+Shift+O lists symbols in the file; Ctrl+F12 lists the methods and fields; Navigate > List Methods of Class shows another class.',
      'F12 goes to a definition, Shift+F12 finds usages, Ctrl+Alt+B shows implementations, Ctrl+U goes to the supertype, F4 opens the Type Hierarchy page (supertypes, subtypes and members).',
      'Alt+Left and Alt+Right move back and forward through places you jumped from.'),
    H2('Source menu'),
    UL('Generate getters, setters, constructor, toString and equals/hashCode; override inherited methods (Alt+Insert).', 'Organize Imports (Ctrl+Alt+O) removes unused imports, adds missing ones for known classes and sorts them.', 'Format Document (Shift+Alt+F) re-indents Java; Rename Symbol (F2) renames within the file.', 'File > New Java creates a class, interface, enum, record, annotation, a class with main() or a JUnit 5 test in the right package.'),
    H2('Many more editing commands'),
    P('The Edit menu has sub-menus for lines (duplicate, move, delete, join, sort, remove duplicates), selection (expand, multi-cursor), case transforms, folding and indentation. Everything is also in the command palette (Ctrl+Shift+P).'),
  ] },

  { id: 'menus', title: 'Right-click menus & project colours', body: [
    ['h1', 'Right-click menus and project colours'],
    P('Every project folder in the Explorer is recognised by what is inside it and gets a colour stripe and a small tag: Maven, Spring Boot, Quarkus, Gradle, Ant, React, Next.js, Angular, Vue, Svelte, NestJS, Node, Python, Django, Flask, FastAPI, Go, Rust, .NET, PHP, Ruby, Flutter, Terraform, Helm and Docker. In a monorepo every sub-project has its own colour, and the status bar edge takes the colour of the open project.'),
    H2('What each menu offers'),
    UL('Project folder: New (class, component, module ... for that kind of project), the build tool (Maven, Gradle, npm/pnpm/yarn with all scripts from package.json, pip/pytest, Cargo, dotnet ...), Git, Format, Refactor, Lombok (Java), Analyze, Open Terminal Here.',
      'Java package: New class / interface / enum / record / test / sub-package, Format all files, Refactor > Rename Package (updates package lines, imports and Spring/XML settings and moves the folder), Analyze package.',
      'Java class: Generate (getters, setters, constructor, toString, equals/hashCode, override methods, unit test, extract interface), Lombok, Refactor (Rename Class, Move to Another Package, Extract Interface, Organize Imports), Navigate, Analyze, Git.',
      'Other files and folders: Run (node, python, go), Format, Analyze, Git (status, diff, history, blame, stage, discard), Rename, Recycle Bin, Copy path.'),
    P('Commands run in the Terminal panel so you see exactly what is executed. Nothing runs until you pick it. Refactorings that touch many files show how many files and occurrences change and ask first; Git can undo them.'),
    H2('Code advisor'),
    P('While you type, the IDE looks for old-style code and shows a better way. Hover the mark to see the OLD and the MODERN sample code, or click Show side by side. Safe cases have Apply (Ctrl+. also offers it). A small pop-up appears when you have just written old-style code.'),
    UL('Orange on a class: a SOLID principle is violated (too many responsibilities, type-check chains that need polymorphism, an override that throws UnsupportedOperationException, a fat interface, a class that creates its own services).',
      'Blue dotted mark and a lightbulb: a more modern way exists. Java: ExecutorService and virtual threads instead of new Thread, ConcurrentHashMap and CopyOnWriteArrayList, CompletableFuture (timeouts, error handling, allOf, thenCompose), lambdas and method references, Comparator.comparing, streams, Optional, generics (diamond, raw types, wildcards), records, switch expressions, pattern matching, text blocks, java.time, try-with-resources.',
      'Purple dotted mark: Lombok can generate this (getters and setters, constructors, toString/equals, loggers, builders). Right-click the project > Lombok > Add Lombok dependency adds it to pom.xml or build.gradle; completion then knows the generated methods and the error check accepts them.',
      'JavaScript / TypeScript / React: promises and async/await (parallel awaits, forEach(async), unhandled promises, fetch errors, timeouts), modern syntax, React hooks. Python: asyncio (blocking calls inside async def, gather, TaskGroup), pathlib, f-strings, dataclasses, safe defaults.'),
    P('The SUGGESTIONS tab lists everything for the open file, or the whole project after Analyze whole project. Settings > General > Code advisor turns the advisor, the orange warnings or the pop-ups off. "Don’t suggest this again" hides one rule; Advisor: Re-enable All Suggestions brings them back.'),
  ] },

  { id: 'keys', title: 'Keyboard shortcuts', body: [
    ['h1', 'Keyboard shortcuts'],
    ['table', [
      ['New project / New Java class', 'Ctrl+Shift+N / Ctrl+Alt+N'], ['Open folder', 'Ctrl+O'], ['Save / Save all', 'Ctrl+S / Ctrl+Alt+S'], ['Close tab', 'Ctrl+W'], ['Command palette', 'Ctrl+Shift+P'],
      ['Find / Replace', 'Ctrl+F / Ctrl+H'], ['Find next / previous', 'F3 / Shift+F3'], ['Find / Replace in files', 'Ctrl+Shift+F / Ctrl+Shift+H'], ['Select next occurrence / all', 'Ctrl+D / Ctrl+Shift+L'],
      ['Go to file / line', 'Ctrl+P / Ctrl+G'], ['Open Java class', 'Ctrl+Shift+T'], ['Go to symbol (workspace / file)', 'Ctrl+T / Ctrl+Shift+O'], ['List methods', 'Ctrl+F12'],
      ['Go to definition / usages', 'F12 / Shift+F12'], ['Peek definition', 'Alt+F12'], ['Implementations', 'Ctrl+Alt+B'], ['Supertype', 'Ctrl+U'], ['Type hierarchy', 'F4'], ['Back / forward', 'Alt+Left / Alt+Right'],
      ['Complete / parameter hints', 'Ctrl+Space / Ctrl+Shift+Space'], ['Quick fix', 'Ctrl+.'], ['Rename', 'F2'], ['Format document', 'Shift+Alt+F'], ['Organize imports', 'Ctrl+Alt+O'], ['Generate code', 'Alt+Insert'],
      ['Comment line / block', 'Ctrl+/ / Shift+Alt+A'], ['Move line up / down', 'Alt+Up / Alt+Down'], ['Duplicate line', 'Shift+Alt+Down'], ['Delete line', 'Ctrl+Shift+K'], ['Add cursor above / below', 'Ctrl+Alt+Up / Ctrl+Alt+Down'],
      ['Expand / shrink selection', 'Shift+Alt+Right / Shift+Alt+Left'], ['Fold / unfold', 'Ctrl+Shift+[ / Ctrl+Shift+]'], ['Toggle word wrap', 'Alt+Z'],
      ['Toggle sidebar', 'Ctrl+B'], ['Explorer / Clouds', 'Ctrl+Shift+E / Ctrl+Shift+C'], ['Toggle terminal', 'Ctrl+`'], ['Maximize / restore bottom panel', 'Ctrl+Shift+M'],
      ['Focus mode', 'Ctrl+K Z, Esc to leave'], ['AI assistant', 'Ctrl+Shift+A'], ['Build / Run / Debug / Stop', 'Ctrl+F9 / F5 / Ctrl+F5 / Shift+F5'], ['Run this file', 'Ctrl+Shift+F10'],
      ['Next / previous tab', 'Ctrl+PageDown / Ctrl+PageUp'], ['Settings', 'Ctrl+,'], ['Help', 'F1'],
    ]],
  ] },

  { id: 'limits', title: 'Limits to know about', body: [
    ['h1', 'Limits to know about'],
    UL('Debug launches the program with its debug agent and shows the port; stepping through code inside the IDE is not built yet.',
      'The terminal runs commands one at a time; it is not a full terminal emulator.',
      'AI chat returns a whole answer at once (no streaming).',
      'Resource explorers exist for Google Cloud services. AWS, Azure and Kubernetes services show a note and a browser link.',
      'The installer is not code-signed, so Windows SmartScreen may warn when you run it.'),
  ] },
];

function helpNode(item) {
  const [kind, val] = item;
  if (kind === 'h1' || kind === 'h2') return h(kind, { text: val });
  if (kind === 'p') return h('p', { text: val });
  if (kind === 'ul') return h('ul', {}, val.map((t) => h('li', { text: t })));
  if (kind === 'table') return h('table', { class: 'table' }, h('tbody', {}, val.map(([a, b]) => h('tr', {}, h('td', { text: a }), h('td', {}, h('kbd', { text: b }))))));
  return h('div');
}

function openHelp(topic) {
  const want = HELP.some((t) => t.id === topic) ? topic : 'start';
  const existing = state.tabs.find((t) => t.kind === 'page' && t.id === 'help');
  if (existing) { activate(existing); if (existing.show) existing.show(want); return; }
  openPage({
    id: 'help', title: 'Help', icon: '❔',
    build(el, tab) {
      const nav = h('div', { class: 'helpnav' });
      const body = h('div', { class: 'helpbody' });
      const show = (id) => {
        const t = HELP.find((x) => x.id === id) || HELP[0];
        nav.replaceChildren(...HELP.map((x) => h('button', { class: x.id === t.id ? 'active' : '', text: x.title, onclick: () => show(x.id) })));
        body.replaceChildren(h('div', {}, t.body.map(helpNode)));
        body.scrollTop = 0;
      };
      tab.show = show;
      el.append(h('div', { class: 'helpwrap' }, nav, body));
      show(want);
    },
  });
}
