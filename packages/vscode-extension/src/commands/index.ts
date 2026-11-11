/**
 * Command registrations
 */

import * as vscode from 'vscode';
import { AuthManager } from '../providers/authManager';
import { ServiceExplorerProvider, ServiceTreeItem } from '../views/serviceExplorer';
import { StatusProvider } from '../views/statusProvider';
import { ServiceCatalog } from '@cnd-ide/core-sdk';
import { runBootstrapWizard } from './bootstrap';

export function registerCommands(
  context: vscode.ExtensionContext,
  authManager: AuthManager,
  serviceExplorer: ServiceExplorerProvider,
  statusProvider: StatusProvider
) {
  context.subscriptions.push(
    vscode.commands.registerCommand('cnd.signIn', () => authManager.signIn()),
    vscode.commands.registerCommand('cnd.signOut', () => authManager.signOut()),
    vscode.commands.registerCommand('cnd.impersonateSa', () => authManager.impersonateSa()),
    vscode.commands.registerCommand('cnd.clearImpersonation', () =>
      authManager.clearImpersonation()
    ),
    vscode.commands.registerCommand('cnd.setProject', () => authManager.setProject()),
    vscode.commands.registerCommand('cnd.bootstrapProject', () =>
      runBootstrapWizard(authManager)
    ),
    vscode.commands.registerCommand('cnd.refreshServices', () => {
      serviceExplorer.refresh();
      statusProvider.refresh();
    }),
    vscode.commands.registerCommand('cnd.openInConsole', (item: ServiceTreeItem) => {
      if (item?.service?.consoleUrl && authManager.projectId) {
        const url = item.service.consoleUrl(authManager.projectId);
        vscode.env.openExternal(vscode.Uri.parse(url));
      }
    }),
    vscode.commands.registerCommand('cnd.enableService', async (item: ServiceTreeItem) => {
      if (!item?.service || !authManager.projectId) return;
      const confirm = await vscode.window.showWarningMessage(
        `Enable ${item.service.title} in project ${authManager.projectId}?`,
        { modal: true },
        'Enable'
      );
      if (confirm !== 'Enable') return;
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Enabling ${item.service.title}…` },
          async () => {
            const catalog = new ServiceCatalog();
            await catalog.enableService(authManager.projectId!, item.service.name);
          }
        );
        vscode.window.showInformationMessage(`${item.service.title} enable requested.`);
        serviceExplorer.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to enable service: ${err.message}`);
      }
    })
  );
}
