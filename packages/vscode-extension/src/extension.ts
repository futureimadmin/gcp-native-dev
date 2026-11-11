/**
 * Cloud Native Development IDE – VS Code Extension
 * Entry point
 */

import * as vscode from 'vscode';
import { ServiceExplorerProvider } from './views/serviceExplorer';
import { StatusProvider } from './views/statusProvider';
import { AuthManager } from './providers/authManager';
import { registerCommands } from './commands';

let authManager: AuthManager;
let serviceExplorerProvider: ServiceExplorerProvider;
let statusProvider: StatusProvider;

export async function activate(context: vscode.ExtensionContext) {
  console.log('CND-IDE: Activating Cloud Native Development IDE extension');

  authManager = new AuthManager(context);
  serviceExplorerProvider = new ServiceExplorerProvider(authManager);
  statusProvider = new StatusProvider(authManager);

  const serviceExplorer = vscode.window.createTreeView('cndServiceExplorer', {
    treeDataProvider: serviceExplorerProvider,
    showCollapseAll: true,
  });

  const statusView = vscode.window.createTreeView('cndStatus', {
    treeDataProvider: statusProvider,
  });

  context.subscriptions.push(serviceExplorer, statusView);
  registerCommands(context, authManager, serviceExplorerProvider, statusProvider);
  statusProvider.refresh();

  const hasShownWelcome = context.globalState.get<boolean>('cnd.hasShownWelcome');
  if (!hasShownWelcome) {
    const action = await vscode.window.showInformationMessage(
      'Welcome to GCP Native Dev IDE. Sign in, select your project, then optionally create default environments (dev/sit/uat/prod).',
      'Sign In',
      'Bootstrap Project',
      'Later'
    );
    if (action === 'Sign In') {
      await vscode.commands.executeCommand('cnd.signIn');
    } else if (action === 'Bootstrap Project') {
      await vscode.commands.executeCommand('cnd.bootstrapProject');
    }
    await context.globalState.update('cnd.hasShownWelcome', true);
  } else if (authManager.projectId) {
    const bootstrapKey = `cnd.bootstrapAsked.${authManager.projectId}`;
    if (!context.globalState.get<boolean>(bootstrapKey)) {
      const want = await vscode.window.showInformationMessage(
        `Project "${authManager.projectId}" is active. Create default environments (dev, sit, uat, prod) with CI/CD, Storage, Firestore, Gemini, BigQuery, and least-privilege IAM?`,
        'Yes – Default Setup',
        'Not now'
      );
      if (want === 'Yes – Default Setup') {
        await vscode.commands.executeCommand('cnd.bootstrapProject');
      }
      await context.globalState.update(bootstrapKey, true);
    }
  }

  console.log('CND-IDE: Extension activated successfully');
}

export function deactivate() {
  console.log('CND-IDE: Deactivating');
}
