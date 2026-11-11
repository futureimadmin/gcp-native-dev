/**
 * Local toolchain profile manager (JDK, Python, Node, Maven, …)
 */

import {
  DEFAULT_RUNTIME_CATALOG,
  RuntimeKind,
  RuntimeManager,
  RuntimeVersion,
  ToolchainProfile,
} from './types';

export class LocalRuntimeManager implements RuntimeManager {
  private profiles = new Map<string, ToolchainProfile>();
  private activeId: string | null = null;
  private installed: RuntimeVersion[] = [];

  constructor() {
    const def: ToolchainProfile = {
      id: 'default',
      name: 'Default',
      runtimes: { jdk: '21', python: '3.12', node: '22' },
      buildTools: { maven: '3.9', npm: '10' },
    };
    this.profiles.set(def.id, def);
    this.activeId = def.id;
  }

  async listInstalled(kind: RuntimeKind): Promise<RuntimeVersion[]> {
    return this.installed.filter((r) => r.kind === kind);
  }

  async listAvailable(kind: RuntimeKind): Promise<RuntimeVersion[]> {
    return (DEFAULT_RUNTIME_CATALOG[kind] || []).map((version) => ({
      kind,
      version,
      lts: ['17', '21', '3.12', '20', '22', '8'].includes(version),
    }));
  }

  async install(kind: RuntimeKind, version: string): Promise<RuntimeVersion> {
    const rt: RuntimeVersion = {
      kind,
      version,
      home: `${process.env.CND_RUNTIMES || '~/.cnd/runtimes'}/${kind}/${version}`,
      lts: true,
    };
    this.installed = this.installed.filter((r) => !(r.kind === kind && r.version === version));
    this.installed.push(rt);
    return rt;
  }

  async getActiveProfile(): Promise<ToolchainProfile | null> {
    return this.activeId ? this.profiles.get(this.activeId) || null : null;
  }

  async setActiveProfile(profileId: string): Promise<void> {
    if (!this.profiles.has(profileId)) throw new Error(`Unknown profile ${profileId}`);
    this.activeId = profileId;
  }

  async upsertProfile(profile: ToolchainProfile): Promise<void> {
    this.profiles.set(profile.id, profile);
  }

  async resolveEnv(profileId?: string): Promise<Record<string, string>> {
    const id = profileId || this.activeId;
    const profile = id ? this.profiles.get(id) : null;
    if (!profile) return {};
    const env: Record<string, string> = {};
    const base = process.env.CND_RUNTIMES || `${process.env.HOME || '/home/user'}/.cnd/runtimes`;
    if (profile.runtimes.jdk) {
      env.JAVA_HOME = `${base}/jdk/${profile.runtimes.jdk}`;
      env.PATH = `${env.JAVA_HOME}/bin:$PATH`;
    }
    if (profile.runtimes.python) {
      env.PATH = `${base}/python/${profile.runtimes.python}/bin:${env.PATH || '$PATH'}`;
    }
    if (profile.runtimes.node) {
      env.PATH = `${base}/node/${profile.runtimes.node}/bin:${env.PATH || '$PATH'}`;
    }
    if (profile.buildTools.maven) {
      env.M2_HOME = `${base}/maven/${profile.buildTools.maven}`;
      env.PATH = `${env.M2_HOME}/bin:${env.PATH || '$PATH'}`;
    }
    return env;
  }

  listProfiles(): ToolchainProfile[] {
    return [...this.profiles.values()];
  }
}
