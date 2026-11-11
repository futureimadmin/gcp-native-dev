/**
 * Service Account Impersonation helpers for CND-IDE
 */

import { GoogleAuth, Impersonated } from 'google-auth-library';

export interface ImpersonationOptions {
  targetPrincipal: string;
  scopes?: string[];
  lifetime?: number;
  delegates?: string[];
}

export interface ImpersonatedCredentials {
  accessToken: string;
  expireTime: string;
  targetPrincipal: string;
}

export async function createImpersonatedAuth(options: ImpersonationOptions): Promise<Impersonated> {
  const auth = new GoogleAuth({
    scopes: options.scopes || ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  return new Impersonated({
    sourceClient: client as any,
    targetPrincipal: options.targetPrincipal,
    lifetime: options.lifetime || 3600,
    delegates: options.delegates || [],
    targetScopes: options.scopes || ['https://www.googleapis.com/auth/cloud-platform'],
  });
}

export async function getImpersonatedAccessToken(
  options: ImpersonationOptions
): Promise<ImpersonatedCredentials> {
  const impersonated = await createImpersonatedAuth(options);
  const tokenResponse = await impersonated.getAccessToken();
  if (!tokenResponse.token) throw new Error('Failed to obtain impersonated access token');
  const expireTime = new Date(Date.now() + (options.lifetime || 3600) * 1000).toISOString();
  return {
    accessToken: tokenResponse.token,
    expireTime,
    targetPrincipal: options.targetPrincipal,
  };
}

export const CND_SERVICE_ACCOUNTS = {
  DEV: (projectId: string) => `cnd-dev-sa@${projectId}.iam.gserviceaccount.com`,
  CICD: (projectId: string) => `cnd-cicd-sa@${projectId}.iam.gserviceaccount.com`,
  OBS: (projectId: string) => `cnd-obs-sa@${projectId}.iam.gserviceaccount.com`,
} as const;

export async function impersonateDevSa(
  projectId: string,
  lifetimeSeconds = 3600
): Promise<ImpersonatedCredentials> {
  return getImpersonatedAccessToken({
    targetPrincipal: CND_SERVICE_ACCOUNTS.DEV(projectId),
    lifetime: lifetimeSeconds,
  });
}
