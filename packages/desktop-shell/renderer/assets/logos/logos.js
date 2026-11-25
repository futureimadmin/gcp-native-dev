/* The IDE's logo library: which logo files exist, who owns them, where they came from and under what terms.
   Files live next to this one (renderer/assets/logos). To add or replace a logo: drop the .svg or .png here, add one line to
   LOGO_MANIFEST, and (for a service in the architecture wizard) map the service id in SERVICE_LOGO. See README.md in this folder. */
'use strict';

const LOGO_BASE = 'assets/logos/';

const LOGO_MANIFEST = {
  googlecloud: { file: 'googlecloud.svg', name: 'Google Cloud', owner: 'Google LLC', source: 'Simple Icons 13.21.0 · cdn.jsdelivr.net/npm/simple-icons@13.21.0/icons/googlecloud.svg', license: 'Artwork CC0 1.0 (Simple Icons). Trademark of Google LLC.' },
  googlebigquery: { file: 'googlebigquery.svg', name: 'BigQuery', owner: 'Google LLC', source: 'Simple Icons 13.21.0 · icons/googlebigquery.svg', license: 'Artwork CC0 1.0 (Simple Icons). Trademark of Google LLC.' },
  googlecloudspanner: { file: 'googlecloudspanner.svg', name: 'Cloud Spanner', owner: 'Google LLC', source: 'Simple Icons 13.21.0 · icons/googlecloudspanner.svg', license: 'Artwork CC0 1.0 (Simple Icons). Trademark of Google LLC.' },
  googlecloudstorage: { file: 'googlecloudstorage.svg', name: 'Cloud Storage', owner: 'Google LLC', source: 'Simple Icons 13.21.0 · icons/googlecloudstorage.svg', license: 'Artwork CC0 1.0 (Simple Icons). Trademark of Google LLC.' },
  googlecloudcomposer: { file: 'googlecloudcomposer.svg', name: 'Cloud Composer', owner: 'Google LLC', source: 'Simple Icons 13.21.0 · icons/googlecloudcomposer.svg', license: 'Artwork CC0 1.0 (Simple Icons). Trademark of Google LLC.' },
  googlepubsub: { file: 'googlepubsub.svg', name: 'Pub/Sub', owner: 'Google LLC', source: 'Simple Icons 13.21.0 · icons/googlepubsub.svg', license: 'Artwork CC0 1.0 (Simple Icons). Trademark of Google LLC.' },
  kubernetes: { file: 'kubernetes.svg', name: 'Kubernetes', owner: 'The Linux Foundation (Kubernetes)', source: 'Simple Icons 13.21.0 · icons/kubernetes.svg', license: 'Artwork CC0 1.0 (Simple Icons). Trademark of The Linux Foundation.' },
  redis: { file: 'redis.svg', name: 'Redis', owner: 'Redis Ltd.', source: 'Simple Icons 13.21.0 · icons/redis.svg', license: 'Artwork CC0 1.0 (Simple Icons). Trademark of Redis Ltd.' },
  postgresql: { file: 'postgresql.svg', name: 'PostgreSQL', owner: 'PostgreSQL Community Association of Canada', source: 'Simple Icons 13.21.0 · icons/postgresql.svg', license: 'Artwork CC0 1.0 (Simple Icons). Trademark of the PostgreSQL Community Association.' },
  terraform: { file: 'terraform.svg', name: 'Terraform', owner: 'HashiCorp, an IBM company', source: 'Simple Icons 13.21.0 · icons/terraform.svg', license: 'Artwork CC0 1.0 (Simple Icons). Trademark of HashiCorp.' },
  firebase: { file: 'firebase.svg', name: 'Firebase (used for Firestore)', owner: 'Google LLC', source: 'Simple Icons 13.21.0 · icons/firebase.svg', license: 'Artwork CC0 1.0 (Simple Icons). Trademark of Google LLC.' },
};

/** Which logo identifies which architecture service. A service with no entry gets the IDE's own pictogram instead. */
const SERVICE_LOGO = { gke: 'kubernetes', redis: 'redis', cloudsql: 'postgresql', firestore: 'firebase', pubsub: 'googlepubsub', bigquery: 'googlebigquery', storage: 'googlecloudstorage', spanner: 'googlecloudspanner', gcp: 'googlecloud', terraform: 'terraform' };

const LOGO_NOTICE = 'Logos and product names are trademarks of their owners (Google LLC, The Linux Foundation, Redis Ltd., the PostgreSQL Community Association, HashiCorp). They appear only to identify the services in a diagram and do not imply endorsement. The artwork comes from the Simple Icons project (CC0 1.0); the marks themselves remain the owners’ property. Services without an official logo here use the IDE’s own pictograms. If your organisation’s brand rules require Google’s official architecture icons, replace the files in this folder (see cloud.google.com/icons for their terms).';

/** URL of the logo file for an architecture service id, or '' when the IDE draws its own pictogram. */
function serviceLogoUrl(serviceKind) {
  const id = SERVICE_LOGO[serviceKind];
  const e = id && LOGO_MANIFEST[id];
  return e ? LOGO_BASE + e.file : '';
}
