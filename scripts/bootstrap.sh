#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "→ Bootstrapping CND-IDE at $ROOT"

echo "→ Installing & building core-sdk…"
cd "$ROOT/packages/core-sdk"
npm install
npm run build

echo "→ Installing VS Code extension dependencies…"
cd "$ROOT/packages/vscode-extension"
npm install

echo ""
echo "✅ Bootstrap complete."
echo ""
echo "Next steps:"
echo "  1. cd packages/vscode-extension && code ."
echo "  2. Press F5 to launch Extension Development Host"
echo "  3. Run command 'CND: Sign In' / 'CND: Bootstrap Project & Environments'"
echo ""
echo "For Terraform (service accounts):"
echo "  cd infra/terraform/environments/dev"
echo "  export TF_VAR_project_id=YOUR_PROJECT"
echo "  terraform init && terraform apply"
