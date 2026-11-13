/**
 * Least-privilege Service Catalog.
 * Lists only projects/services the signed-in identity can actually use.
 * Uses Cloud Resource Manager + Service Usage REST APIs with ADC / impersonated credentials.
 */

import { GoogleAuth } from 'google-auth-library';

export type ServiceCategory =
  | 'Compute'
  | 'Storage & Databases'
  | 'AI & Analytics'
  | 'DevOps & CI/CD'
  | 'Security & Identity'
  | 'Observability'
  | 'Other';

export interface AccessibleProject {
  projectId: string;
  displayName: string;
  projectNumber?: string;
  state?: string;
}

export interface GcpService {
  /** Service Usage API name, e.g. run.googleapis.com */
  name: string;
  title: string;
  category: ServiceCategory;
  description?: string;
  enabled: boolean;
  /** Permissions the caller holds that are relevant to this service */
  grantedPermissions?: string[];
  consoleUrl: (projectId: string) => string;
}

interface ServiceDef {
  title: string;
  category: ServiceCategory;
  description: string;
  console: string;
  /** Probe permissions used to test least-privilege access */
  probe: string[];
}

export const SERVICE_DEFS: Record<string, ServiceDef> = {
  'run.googleapis.com': { title: 'Cloud Run', category: 'Compute', description: 'Serverless containers', console: 'run', probe: ['run.services.list'] },
  'cloudfunctions.googleapis.com': { title: 'Cloud Functions', category: 'Compute', description: 'Event-driven functions', console: 'functions/list', probe: ['cloudfunctions.functions.list'] },
  'container.googleapis.com': { title: 'Kubernetes Engine', category: 'Compute', description: 'Managed Kubernetes', console: 'kubernetes/list', probe: ['container.clusters.list'] },
  'storage.googleapis.com': { title: 'Cloud Storage', category: 'Storage & Databases', description: 'Object storage', console: 'storage/browser', probe: ['storage.buckets.list'] },
  'firestore.googleapis.com': { title: 'Firestore', category: 'Storage & Databases', description: 'Serverless document database', console: 'firestore', probe: ['datastore.databases.list'] },
  'sqladmin.googleapis.com': { title: 'Cloud SQL', category: 'Storage & Databases', description: 'Managed relational databases', console: 'sql/instances', probe: ['cloudsql.instances.list'] },
  'bigquery.googleapis.com': { title: 'BigQuery', category: 'AI & Analytics', description: 'Data warehouse & analytics', console: 'bigquery', probe: ['bigquery.datasets.get'] },
  'aiplatform.googleapis.com': { title: 'Vertex AI / Gemini', category: 'AI & Analytics', description: 'Gemini models and ML platform', console: 'vertex-ai', probe: ['aiplatform.endpoints.list'] },
  'cloudbuild.googleapis.com': { title: 'Cloud Build', category: 'DevOps & CI/CD', description: 'CI/CD pipelines', console: 'cloud-build/builds', probe: ['cloudbuild.builds.list'] },
  'artifactregistry.googleapis.com': { title: 'Artifact Registry', category: 'DevOps & CI/CD', description: 'Container and package registry', console: 'artifacts', probe: ['artifactregistry.repositories.list'] },
  'secretmanager.googleapis.com': { title: 'Secret Manager', category: 'Security & Identity', description: 'Secrets storage', console: 'security/secret-manager', probe: ['secretmanager.secrets.list'] },
  'iam.googleapis.com': { title: 'IAM', category: 'Security & Identity', description: 'Identity & access management', console: 'iam-admin/iam', probe: ['resourcemanager.projects.getIamPolicy'] },
  'iamcredentials.googleapis.com': { title: 'IAM Credentials', category: 'Security & Identity', description: 'Short-lived credentials / impersonation', console: 'apis/library/iamcredentials.googleapis.com', probe: [] },
  'logging.googleapis.com': { title: 'Cloud Logging', category: 'Observability', description: 'Log management', console: 'logs', probe: ['logging.logEntries.list'] },
  'cloudtrace.googleapis.com': { title: 'Cloud Trace', category: 'Observability', description: 'Distributed tracing', console: 'traces', probe: ['cloudtrace.traces.get'] },
};

const CRM = 'https://cloudresourcemanager.googleapis.com/v1';
const SU = 'https://serviceusage.googleapis.com/v1';

export interface TokenSource {
  getAccessToken(): Promise<string | null | undefined>;
}

export class ServiceCatalog {
  private readonly auth: TokenSource;

  /** @param auth optional token source (e.g. impersonated credentials); defaults to ADC */
  constructor(auth?: TokenSource) {
    this.auth =
      auth ??
      (new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }) as unknown as TokenSource);
  }

  private async token(): Promise<string> {
    const t = await this.auth.getAccessToken();
    if (!t) throw new Error('Not signed in. Run `gcloud auth application-default login` or sign in from the IDE.');
    return t;
  }

  private async call<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const res = await fetch(url, {
      method: init.method || 'GET',
      headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as T;
  }

  async listAccessibleProjects(): Promise<AccessibleProject[]> {
    const out: AccessibleProject[] = [];
    let pageToken = '';
    do {
      const r = await this.call<any>(
        `${CRM}/projects?filter=lifecycleState:ACTIVE&pageSize=200${pageToken ? `&pageToken=${pageToken}` : ''}`
      );
      for (const p of r.projects || []) {
        out.push({ projectId: p.projectId, displayName: p.name, projectNumber: p.projectNumber, state: p.lifecycleState });
      }
      pageToken = r.nextPageToken || '';
    } while (pageToken);
    return out;
  }

  /** Enabled services intersected with the known catalog, hiding anything the caller has no permission for. */
  async listAccessibleServices(projectId: string): Promise<GcpService[]> {
    const enabled = new Set<string>();
    let pageToken = '';
    do {
      const r = await this.call<any>(
        `${SU}/projects/${projectId}/services?filter=state:ENABLED&pageSize=200${pageToken ? `&pageToken=${pageToken}` : ''}`
      );
      for (const s of r.services || []) enabled.add(String(s.name).split('/').pop()!);
      pageToken = r.nextPageToken || '';
    } while (pageToken);

    const allProbes = [...new Set(Object.values(SERVICE_DEFS).flatMap((d) => d.probe))];
    let granted = new Set<string>(allProbes);
    try {
      const r = await this.call<any>(`${CRM}/projects/${projectId}:testIamPermissions`, {
        method: 'POST',
        body: { permissions: allProbes },
      });
      granted = new Set<string>(r.permissions || []);
    } catch {
      /* probe failed: fall back to showing enabled services */
    }

    const services: GcpService[] = [];
    for (const [name, def] of Object.entries(SERVICE_DEFS)) {
      if (!enabled.has(name)) continue;
      const perms = def.probe.filter((p) => granted.has(p));
      if (def.probe.length > 0 && perms.length === 0) continue; // PoLP: hide what the caller cannot use
      services.push({
        name,
        title: def.title,
        category: def.category,
        description: def.description,
        enabled: true,
        grantedPermissions: perms,
        consoleUrl: (pid) => `https://console.cloud.google.com/${def.console}?project=${pid}`,
      });
    }
    return services;
  }

  async enableService(projectId: string, serviceName: string): Promise<void> {
    await this.call(`${SU}/projects/${projectId}/services/${serviceName}:enable`, { method: 'POST', body: {} });
  }
}
