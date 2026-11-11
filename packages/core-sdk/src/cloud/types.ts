export type CloudProvider = 'gcp' | 'aws' | 'azure';
export type EnvironmentName = 'dev' | 'sit' | 'uat' | 'prod';
export const DEFAULT_ENVIRONMENTS: EnvironmentName[] = ['dev', 'sit', 'uat', 'prod'];

export interface CloudScope {
  provider: CloudProvider;
  id: string;
  displayName: string;
  parentId?: string;
  region?: string;
}

export interface CloudEnvironment {
  name: EnvironmentName;
  scope: CloudScope;
  resourcePrefix: string;
  identityRef: string;
  labels: Record<string, string>;
}

export interface BootstrapRequest {
  provider: CloudProvider;
  scopeId: string;
  environments?: EnvironmentName[];
  region?: string;
  enableDefaultServices?: boolean;
  gitRepo?: string;
}

export interface BootstrapPlan {
  provider: CloudProvider;
  scopeId: string;
  environments: CloudEnvironment[];
  services: string[];
  artifacts: { path: string; content: string; language: string }[];
  summary: string[];
}

export interface AccessibleService {
  provider: CloudProvider;
  id: string;
  title: string;
  category: string;
  enabled: boolean;
  grantedActions: string[];
}

export interface CloudAdapter {
  readonly provider: CloudProvider;
  listScopes(): Promise<CloudScope[]>;
  listAccessibleServices(scopeId: string): Promise<AccessibleService[]>;
  createBootstrapPlan(req: BootstrapRequest): Promise<BootstrapPlan>;
}
