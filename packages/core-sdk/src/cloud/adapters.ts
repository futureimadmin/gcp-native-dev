/**
 * Cloud adapters — GCP, AWS, Azure bootstrap plans (least privilege)
 */

import {
  BootstrapPlan,
  BootstrapRequest,
  CloudAdapter,
  CloudEnvironment,
  CloudProvider,
  CloudScope,
  AccessibleService,
  DEFAULT_ENVIRONMENTS,
} from './types';

function envIdentity(provider: CloudProvider, scopeId: string, env: string): string {
  switch (provider) {
    case 'gcp':
      return `cnd-${env}-sa@${scopeId}.iam.gserviceaccount.com`;
    case 'aws':
      return `arn:aws:iam::${scopeId}:role/cnd-${env}-role`;
    case 'azure':
      return `cnd-${env}-mi`;
    default:
      return `cnd-${env}`;
  }
}

function defaultServices(provider: CloudProvider): string[] {
  switch (provider) {
    case 'gcp':
      return ['run.googleapis.com','cloudfunctions.googleapis.com','storage.googleapis.com','firestore.googleapis.com','aiplatform.googleapis.com','bigquery.googleapis.com','artifactregistry.googleapis.com','secretmanager.googleapis.com','cloudbuild.googleapis.com'];
    case 'aws':
      return ['lambda','ecs','eks','s3','dynamodb','rds','ecr','secretsmanager','codebuild','bedrock'];
    case 'azure':
      return ['Microsoft.Web','Microsoft.ContainerService','Microsoft.Storage','Microsoft.DocumentDB','Microsoft.ContainerRegistry','Microsoft.KeyVault','Microsoft.CognitiveServices','Microsoft.Sql'];
    default:
      return [];
  }
}

function buildEnvironments(provider: CloudProvider, scopeId: string, envs: string[], region: string): CloudEnvironment[] {
  const prefix = scopeId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 16).toLowerCase();
  return envs.map((name) => ({
    name: name as CloudEnvironment['name'],
    scope: { provider, id: scopeId, displayName: scopeId, region },
    resourcePrefix: `${prefix}-${name}`,
    identityRef: envIdentity(provider, scopeId, name),
    labels: { environment: name, 'managed-by': 'cloud-native-studio', provider },
  }));
}

export class GcpAdapter implements CloudAdapter {
  readonly provider = 'gcp' as const;
  async listScopes(): Promise<CloudScope[]> { return []; }
  async listAccessibleServices(_scopeId: string): Promise<AccessibleService[]> { return []; }
  async createBootstrapPlan(req: BootstrapRequest): Promise<BootstrapPlan> {
    const envs = req.environments || DEFAULT_ENVIRONMENTS;
    const region = req.region || 'us-central1';
    const environments = buildEnvironments('gcp', req.scopeId, envs, region);
    const services = req.enableDefaultServices !== false ? defaultServices('gcp') : [];
    const tf = `# Cloud Native Studio — GCP bootstrap\n# Project: ${req.scopeId}\nvariable "project_id" { default = "${req.scopeId}" }\n`;
    return {
      provider: 'gcp', scopeId: req.scopeId, environments, services,
      artifacts: [{ path: 'infra/cnd-bootstrap/gcp/main.tf', content: tf, language: 'hcl' }],
      summary: [`GCP project ${req.scopeId}`, `Environments: ${envs.join(', ')}`, `Region: ${region}`],
    };
  }
}

export class AwsAdapter implements CloudAdapter {
  readonly provider = 'aws' as const;
  async listScopes(): Promise<CloudScope[]> { return []; }
  async listAccessibleServices(_scopeId: string): Promise<AccessibleService[]> { return []; }
  async createBootstrapPlan(req: BootstrapRequest): Promise<BootstrapPlan> {
    const envs = req.environments || DEFAULT_ENVIRONMENTS;
    const region = req.region || 'us-east-1';
    const environments = buildEnvironments('aws', req.scopeId, envs, region);
    const services = req.enableDefaultServices !== false ? defaultServices('aws') : [];
    const yaml = `# AWS bootstrap account ${req.scopeId} region ${region} envs ${envs.join(',')}`;
    return {
      provider: 'aws', scopeId: req.scopeId, environments, services,
      artifacts: [{ path: 'infra/cnd-bootstrap/aws/template.yaml', content: yaml, language: 'yaml' }],
      summary: [`AWS account ${req.scopeId}`, `Environments: ${envs.join(', ')}`, `Region: ${region}`],
    };
  }
}

export class AzureAdapter implements CloudAdapter {
  readonly provider = 'azure' as const;
  async listScopes(): Promise<CloudScope[]> { return []; }
  async listAccessibleServices(_scopeId: string): Promise<AccessibleService[]> { return []; }
  async createBootstrapPlan(req: BootstrapRequest): Promise<BootstrapPlan> {
    const envs = req.environments || DEFAULT_ENVIRONMENTS;
    const region = req.region || 'eastus';
    const environments = buildEnvironments('azure', req.scopeId, envs, region);
    const services = req.enableDefaultServices !== false ? defaultServices('azure') : [];
    const bicep = `// Azure bootstrap subscription ${req.scopeId}`;
    return {
      provider: 'azure', scopeId: req.scopeId, environments, services,
      artifacts: [{ path: 'infra/cnd-bootstrap/azure/main.bicep', content: bicep, language: 'bicep' }],
      summary: [`Azure subscription ${req.scopeId}`, `Environments: ${envs.join(', ')}`, `Region: ${region}`],
    };
  }
}

export function getAdapter(provider: CloudProvider): CloudAdapter {
  switch (provider) {
    case 'gcp': return new GcpAdapter();
    case 'aws': return new AwsAdapter();
    case 'azure': return new AzureAdapter();
    default: throw new Error(`Unknown provider: ${provider}`);
  }
}
