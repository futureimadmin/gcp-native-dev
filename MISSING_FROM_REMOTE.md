# Files still local-only or incomplete on GitHub

| Path | Notes |
|------|--------|
| `packages/core-sdk/src/services/catalog.ts` | Full PoLP catalog (~12KB) — push separately if needed |
| `packages/vscode-extension/src/providers/authManager.ts` | Full auth manager (~7KB) |
| `docs/demo/slides/*.png` | Demo slide images |
| `docs/demo/video/*.mp4` (real binary) | Only LFS **pointer** is on GitHub; upload binary via `git lfs push` |

Core Studio / multi-cloud / desktop / runtimes / registries **are** on `main`.
