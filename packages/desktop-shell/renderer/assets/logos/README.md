# Logos

The IDE's logo library. The architecture wizard draws these next to services in its diagrams.

| File | What it is |
|---|---|
| `*.svg` | one logo each, single colour, a `fill` set on the root element |
| `logos.js` | the manifest: file, owner, source and licence of every logo, and which service each one identifies |

## Add or replace a logo

1. Put the `.svg` (or `.png`) in this folder. SVG should be square (viewBox `0 0 24 24` works best) and set its colour with `fill` on the `<svg>` element.
2. Add one line to `LOGO_MANIFEST` in `logos.js` with the file name, owner, where it came from and the licence.
3. To use it for a service of the architecture wizard, add the service id to `SERVICE_LOGO` (for example `octopus: 'octopus'`).

A service without a logo is drawn with the IDE's own pictogram, so nothing breaks when a file is missing.

## Licence

The artwork here comes from [Simple Icons](https://simpleicons.org) 13.21.0, released under **CC0 1.0** (no restrictions on the drawings).
**The marks are not.** Logos and product names are trademarks of their owners: Google LLC, The Linux Foundation, Redis Ltd., the
PostgreSQL Community Association, HashiCorp. They are used only to identify the services in a diagram and do not imply endorsement.

Some services have no logo here (Cloud Run, Cloud SQL as a product, Secret Manager, KMS, Cloud Armor, Apigee, Octopus API Gateway). The IDE draws its
own pictogram for them. Google publishes official architecture icons at cloud.google.com/icons: check their terms, and if your organisation's
brand rules need them, drop them here and map them in `logos.js`. A logo of Octopus API Gateway can be added the same way.
