/**
 * Service Explorer – only projects/services the developer can use (PoLP)
 */

import * as vscode from 'vscode';
import { ServiceCatalog, GcpService } from '@cnd-ide/core-sdk';
import { AuthManager } from '../providers/authManager';

export class ServiceTreeItem extends vscode.TreeItem {
  constructor(
    public readonly service: GcpService,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(service.title, collapsibleState);
    const permCount = service.grantedPermissions?.length ?? 0;
    this.tooltip = new vscode.MarkdownString(
      `**${service.title}**\n\n${service.description || ''}\n\nYou have ${permCount} relevant permission(s).`
    );
    this.description = 'Accessible';
    this.contextValue = 'service';
    this.iconPath = new vscode.ThemeIcon('cloud');
  }
}

export class CategoryTreeItem extends vscode.TreeItem {
  constructor(
    public readonly category: string,
    public readonly services: GcpService[]
  ) {
    super(category, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'category';
    this.iconPath = new vscode.ThemeIcon('folder');
    this.description = `${services.length} service(s)`;
  }
}

export class ServiceExplorerProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private services: GcpService[] = [];
  private authManager: AuthManager;

  constructor(authManager: AuthManager) {
    this.authManager = authManager;
    authManager.onDidChangeAuth(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    const projectId = this.authManager.projectId;
    if (!projectId) {
      return [new vscode.TreeItem('No project selected – run "CND: Set Active Project"', vscode.TreeItemCollapsibleState.None)];
    }
    if (!element) {
      try {
        const catalog = new ServiceCatalog();
        this.services = await catalog.listAccessibleServices(projectId);
      } catch (err: any) {
        return [new vscode.TreeItem(`Unable to load services: ${err?.message || err}`, vscode.TreeItemCollapsibleState.None)];
      }
      if (this.services.length === 0) {
        return [new vscode.TreeItem('No accessible services in this project', vscode.TreeItemCollapsibleState.None)];
      }
      const byCategory = new Map<string, GcpService[]>();
      for (const svc of this.services) {
        const list = byCategory.get(svc.category) || [];
        list.push(svc);
        byCategory.set(svc.category, list);
      }
      return Array.from(byCategory.entries()).map(
        ([category, services]) => new CategoryTreeItem(category, services)
      );
    }
    if (element instanceof CategoryTreeItem) {
      return element.services.map((svc) => new ServiceTreeItem(svc, vscode.TreeItemCollapsibleState.None));
    }
    return [];
  }
}
