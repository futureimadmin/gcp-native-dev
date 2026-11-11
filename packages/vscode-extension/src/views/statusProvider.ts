/**
 * Simple Status view showing current auth / impersonation state
 */

import * as vscode from 'vscode';
import { AuthManager } from '../providers/authManager';

export class StatusProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private authManager: AuthManager) {
    authManager.onDidChangeAuth(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    const state = this.authManager.state;

    const items: vscode.TreeItem[] = [];

    const projectItem = new vscode.TreeItem(
      `Project: ${state.projectId || '(not set)'}`,
      vscode.TreeItemCollapsibleState.None
    );
    projectItem.iconPath = new vscode.ThemeIcon('project');
    items.push(projectItem);

    const identityItem = new vscode.TreeItem(
      state.impersonating
        ? `Impersonating: ${state.impersonating}`
        : 'Identity: User credentials',
      vscode.TreeItemCollapsibleState.None
    );
    identityItem.iconPath = new vscode.ThemeIcon(
      state.impersonating ? 'shield' : 'account'
    );
    items.push(identityItem);

    return items;
  }
}
