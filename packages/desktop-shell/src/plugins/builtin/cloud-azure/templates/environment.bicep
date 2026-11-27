// Nativity Studio environment: one RESOURCE GROUP per environment, deployed from this template.
// Container Apps environment + Log Analytics + Container Registry + Key Vault, and two managed identities (no passwords, no keys):
//   runtime  = identity of the running app (pulls images, reads secrets)
//   deployer = identity pipelines use to change this environment (pushes images, deploys inside this resource group only)
targetScope = 'resourceGroup'

param appName string
param envName string
param location string = resourceGroup().location
@description('Protected (production-like): purge protection, longer log retention, Standard registry')
param protectedEnv bool = false

@description('Optional owner/name of a GitHub repository whose pipeline may sign in as the deployer identity of this environment (OpenID Connect, no secrets).')
param githubRepo string = ''

var prefix = '${appName}-${envName}'
var suffix = uniqueString(resourceGroup().id)
var tags = {
  app: appName
  environment: envName
  'managed-by': 'nativity-studio'
}

// built-in role ids
var acrPull = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var acrPush = '8311e382-0749-4cb8-b61a-304f252e45ec'
var kvSecretsUser = '4633458b-17de-48c2-bfbd-1dbd4e1f4a4a'
var contributor = 'b24988ac-6180-42a0-ab88-20f7382dd24c'

resource logs 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: '${prefix}-logs'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: protectedEnv ? 90 : 30
  }
}

resource apps 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: '${prefix}-cae'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: take('acr${replace(prefix, '-', '')}${suffix}', 50)
  location: location
  tags: tags
  sku: { name: protectedEnv ? 'Standard' : 'Basic' }
  properties: { adminUserEnabled: false }
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: take('kv${replace(prefix, '-', '')}${suffix}', 24)
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: protectedEnv ? true : null
  }
}

resource runtime 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${prefix}-runtime'
  location: location
  tags: tags
}

resource deployer 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${prefix}-deployer'
  location: location
  tags: tags
}

resource runtimePull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, runtime.id, acrPull)
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPull)
    principalId: runtime.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource runtimeSecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, runtime.id, kvSecretsUser)
  scope: vault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsUser)
    principalId: runtime.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource deployerPush 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, deployer.id, acrPush)
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPush)
    principalId: deployer.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// the deployer may change things inside THIS resource group only
resource deployerRg 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, deployer.id, contributor)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', contributor)
    principalId: deployer.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// lets the GitHub environment of this stage sign in as the deployer with no stored secret
resource deployerGithub 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = if (!empty(githubRepo)) {
  parent: deployer
  name: 'github-${envName}'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: 'repo:${githubRepo}:environment:${envName}'
    audiences: ['api://AzureADTokenExchange']
  }
}

output containerAppsEnvironment string = apps.name
output registryLoginServer string = registry.properties.loginServer
output keyVaultName string = vault.name
output runtimeIdentity string = runtime.id
output deployerIdentity string = deployer.id
output deployerClientId string = deployer.properties.clientId
output registryName string = registry.name
