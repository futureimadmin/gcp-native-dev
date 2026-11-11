/**
 * Package registry configuration (Maven, Nexus, npm, PyPI, containers)
 */

export type RegistryEcosystem = 'maven' | 'npm' | 'pypi' | 'docker' | 'nuget';
export type RegistryProvider =
  | 'nexus'
  | 'artifactory'
  | 'codeartifact'
  | 'artifact-registry'
  | 'acr'
  | 'ecr'
  | 'github-packages'
  | 'generic';

export interface RegistryEndpoint {
  id: string;
  name: string;
  ecosystem: RegistryEcosystem;
  provider: RegistryProvider;
  url: string;
  cloudProvider?: 'gcp' | 'aws' | 'azure';
  usernameEnv?: string;
  tokenEnv?: string;
  isSnapshot?: boolean;
  isRelease?: boolean;
}

export interface RegistryManager {
  list(): Promise<RegistryEndpoint[]>;
  add(endpoint: RegistryEndpoint): Promise<void>;
  remove(id: string): Promise<void>;
  applyToWorkspace(workspaceRoot: string, ecosystems: RegistryEcosystem[]): Promise<string[]>;
}

export function mavenSettingsXml(
  endpoints: RegistryEndpoint[],
  servers: { id: string; username: string; password: string }[]
): string {
  const mirrors = endpoints
    .filter((e) => e.ecosystem === 'maven')
    .map(
      (e) => `
    <mirror>
      <id>${e.id}</id>
      <name>${e.name}</name>
      <url>${e.url}</url>
      <mirrorOf>*</mirrorOf>
    </mirror>`
    )
    .join('\n');
  const serverBlocks = servers
    .map(
      (s) => `
    <server>
      <id>${s.id}</id>
      <username>${s.username}</username>
      <password>${s.password}</password>
    </server>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<settings xmlns="http://maven.apache.org/SETTINGS/1.2.0">
  <mirrors>
${mirrors}
  </mirrors>
  <servers>
${serverBlocks}
  </servers>
</settings>
`;
}

export function npmrcFor(endpoints: RegistryEndpoint[]): string {
  const lines: string[] = [];
  for (const e of endpoints.filter((x) => x.ecosystem === 'npm')) {
    try {
      const host = new URL(e.url).host;
      lines.push(`registry=${e.url}`);
      lines.push(`//${host}/:_authToken=\${${e.tokenEnv || 'NPM_TOKEN'}}`);
    } catch {
      lines.push(`# invalid url: ${e.url}`);
    }
  }
  return lines.join('\n') + '\n';
}

export function pipConfFor(endpoints: RegistryEndpoint[]): string {
  const pypi = endpoints.filter((e) => e.ecosystem === 'pypi');
  if (!pypi.length) return '';
  return `[global]
index-url = ${pypi[0].url}
timeout = 60
`;
}
