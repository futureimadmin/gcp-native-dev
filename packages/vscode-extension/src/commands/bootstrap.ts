/**
 * Project / Environment bootstrap commands
 */

import * as vscode from 'vscode';
import {
  createBootstrapPlan,
  describeDefaultSetup,
  BootstrapOptions,
  DEFAULT_ENVIRONMENTS,
} from '@cnd-ide/core-sdk';
import { AuthManager } from '../providers/authManager';

export async function runBootstrapWizard(authManager: AuthManager): Promise<void> {
  const projectId = authManager.projectId;
  if (!projectId) {
    const set = await vscode.window.showWarningMessage(
      'No project selected. Select a project first?',
      'Select Project',
      'Cancel'
    );
    if (set === 'Select Project') await authManager.setProject();
    return;
  }

  const useDefault = await vscode.window.showInformationMessage(
    `Create default environments (dev, sit, uat, prod) for project "${projectId}"?\n\n` +
      'This enables CI/CD, Cloud Functions, Storage, Firestore, Gemini, BigQuery, ' +
      'Artifact Registry, Secret Manager, and least-privilege IAM.',
    { modal: true },
    'Yes – Default Setup',
    'Custom…',
    'Skip'
  );

  if (!useDefault || useDefault === 'Skip') return;

  let options: BootstrapOptions = {
    projectId,
    createDefaultEnvironments: true,
    enableDefaultServices: true,
  };

  if (useDefault === 'Custom…') {
    const envPick = await vscode.window.showQuickPick(
      DEFAULT_ENVIRONMENTS.map((e) => ({ label: e, picked: true })),
      { canPickMany: true, placeHolder: 'Select environments to create', ignoreFocusOut: true }
    );
    if (!envPick || envPick.length === 0) return;
    options.environments = envPick.map((e) => e.label as any);
    options.createDefaultEnvironments = false;
  }

  const plan = createBootstrapPlan(options);
  const detail = [...plan.summary, '', describeDefaultSetup(), '', 'Terraform will be written for review.'].join('\n');

  const confirm = await vscode.window.showInformationMessage(detail, { modal: true }, 'Generate Plan', 'Cancel');
  if (confirm !== 'Generate Plan') return;

  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    const doc = await vscode.workspace.openTextDocument({ language: 'hcl', content: plan.terraformSnippet });
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage('Bootstrap plan generated. Save and run terraform apply.');
    return;
  }

  const root = folders[0].uri;
  const dir = vscode.Uri.joinPath(root, 'infra', 'cnd-bootstrap');
  await vscode.workspace.fs.createDirectory(dir);
  const tfFile = vscode.Uri.joinPath(dir, 'main.tf');
  await vscode.workspace.fs.writeFile(tfFile, Buffer.from(plan.terraformSnippet, 'utf8'));
  const doc = await vscode.workspace.openTextDocument(tfFile);
  await vscode.window.showTextDocument(doc);
  vscode.window.showInformationMessage('Bootstrap plan written to infra/cnd-bootstrap/main.tf');
}
