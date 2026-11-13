/**
 * AuthManager — sign-in, active project and service-account impersonation state.
 */

import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { ServiceCatalog, CND_SERVICE_ACCOUNTS } from '@cnd-ide/core-sdk';

export interface AuthState {
  projectId?: string;
  impersonating?: string;
  signedIn: boolean;
}

export class AuthManager {
  private readonly _onDidChangeAuth = new vscode.EventEmitter<void>();
  readonly onDidChangeAuth = this._onDidChangeAuth.event;
  private _impersonating: string | undefined;
  private _signedIn = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this._impersonating =
      vscode.workspace.getConfiguration('cnd').get<string>('impersonateServiceAccount') || undefined;
  }

  get projectId(): string | undefined {
    return vscode.workspace.getConfiguration('cnd').get<string>('projectId') || undefined;
  }

  get state(): AuthState {
    return { projectId: this.projectId, impersonating: this._impersonating, signedIn: this._signedIn };
  }

  async signIn(): Promise<void> {
    const term = vscode.window.createTerminal('CND Sign In');
    term.show();
    term.sendText('gcloud auth application-default login');
    this._signedIn = true;
    this._onDidChangeAuth.fire();
  }

  async signOut(): Promise<void> {
    await new Promise<void>((res) =>
      spawn('gcloud', ['auth', 'application-default', 'revoke', '--quiet'], { shell: true }).on('close', () => res())
    );
    this._signedIn = false;
    await this.clearImpersonation();
  }

  async setProject(): Promise<void> {
    let items: vscode.QuickPickItem[];
    try {
      const projects = await new ServiceCatalog().listAccessibleProjects();
      items = projects.map((p) => ({ label: p.projectId, description: p.displayName }));
    } catch (e: any) {
      vscode.window.showErrorMessage(`Cannot list projects: ${e?.message || e}`);
      return;
    }
    const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Select active Google Cloud project' });
    if (!pick) return;
    await vscode.workspace
      .getConfiguration('cnd')
      .update('projectId', pick.label, vscode.ConfigurationTarget.Workspace);
    this._signedIn = true;
    this._onDidChangeAuth.fire();
  }

  async impersonateSa(): Promise<void> {
    const projectId = this.projectId;
    if (!projectId) {
      vscode.window.showWarningMessage('Select a project first.');
      return;
    }
    const choices = [
      { label: 'Developer SA', description: CND_SERVICE_ACCOUNTS.DEV(projectId) },
      { label: 'CI/CD SA', description: CND_SERVICE_ACCOUNTS.CICD(projectId) },
      { label: 'Observability SA', description: CND_SERVICE_ACCOUNTS.OBS(projectId) },
    ];
    const pick = await vscode.window.showQuickPick(choices, { placeHolder: 'Impersonate service account' });
    if (!pick?.description) return;
    this._impersonating = pick.description;
    await vscode.workspace
      .getConfiguration('cnd')
      .update('impersonateServiceAccount', pick.description, vscode.ConfigurationTarget.Workspace);
    this._onDidChangeAuth.fire();
  }

  async clearImpersonation(): Promise<void> {
    this._impersonating = undefined;
    await vscode.workspace
      .getConfiguration('cnd')
      .update('impersonateServiceAccount', '', vscode.ConfigurationTarget.Workspace);
    this._onDidChangeAuth.fire();
  }
}
