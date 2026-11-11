/**
 * Runtime & toolchain management for Cloud Native Studio
 */

export type RuntimeKind = 'jdk' | 'python' | 'node' | 'go' | 'dotnet';

export interface RuntimeVersion {
  kind: RuntimeKind;
  version: string;
  home?: string;
  vendor?: string;
  lts?: boolean;
}

export interface ToolchainProfile {
  id: string;
  name: string;
  environment?: string;
  runtimes: Partial<Record<RuntimeKind, string>>;
  buildTools: {
    maven?: string;
    gradle?: string;
    npm?: string;
    pnpm?: string;
    poetry?: string;
    uv?: string;
  };
}

export interface RuntimeManager {
  listInstalled(kind: RuntimeKind): Promise<RuntimeVersion[]>;
  listAvailable(kind: RuntimeKind): Promise<RuntimeVersion[]>;
  install(kind: RuntimeKind, version: string): Promise<RuntimeVersion>;
  getActiveProfile(): Promise<ToolchainProfile | null>;
  setActiveProfile(profileId: string): Promise<void>;
  upsertProfile(profile: ToolchainProfile): Promise<void>;
  resolveEnv(profileId?: string): Promise<Record<string, string>>;
}

export const DEFAULT_RUNTIME_CATALOG: Record<RuntimeKind, string[]> = {
  jdk: ['17', '21', '25'],
  python: ['3.11', '3.12', '3.13'],
  node: ['20', '22'],
  go: ['1.22', '1.23'],
  dotnet: ['8', '9'],
};
