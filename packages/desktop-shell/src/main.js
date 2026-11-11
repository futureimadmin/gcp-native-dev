/**
 * Cloud Native Studio — desktop shell entry (Electron)
 */

const { app, BrowserWindow, Menu } = require('electron');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'Cloud Native Studio',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  win.loadURL(
    'data:text/html;charset=utf-8,' +
      encodeURIComponent(`<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Cloud Native Studio</title>
<style>
body { font-family: Inter, system-ui, sans-serif; background: #0e0f0c; color: #f0ece3;
  display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
.card { max-width: 640px; padding: 48px; border: 1px solid #2a2d28; border-radius: 12px; }
h1 { color: #8a9e90; margin-top: 0; }
code { background: #1a1c18; padding: 2px 6px; border-radius: 4px; }
</style></head>
<body><div class="card">
  <h1>Cloud Native Studio</h1>
  <p>Standalone IDE for <strong>GCP</strong>, <strong>AWS</strong>, and <strong>Azure</strong>.</p>
  <ul>
    <li>Bootstrap environments: <code>dev → sit → uat → prod</code></li>
    <li>Runtimes: JDK, Python, Node, Go, .NET</li>
    <li>Build &amp; registries: Maven, Nexus, npm, PyPI</li>
    <li>Least-privilege access on every cloud</li>
  </ul>
  <p>Workbench = Code-OSS + CND extensions.</p>
</div></body></html>`)
  );

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Cloud',
        submenu: [
          { label: 'Sign In…', enabled: false },
          { label: 'Select Scope…', enabled: false },
          { type: 'separator' },
          { label: 'Bootstrap Environments…', enabled: false },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'Runtimes',
        submenu: [
          { label: 'Manage JDK…', enabled: false },
          { label: 'Manage Python…', enabled: false },
          { label: 'Manage Node…', enabled: false },
          { label: 'Toolchain Profiles…', enabled: false },
        ],
      },
      {
        label: 'Registries',
        submenu: [
          { label: 'Maven / Nexus…', enabled: false },
          { label: 'npm…', enabled: false },
          { label: 'PyPI…', enabled: false },
        ],
      },
    ])
  );
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
