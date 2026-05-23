# cli-gateway-auth-status history

- Started stacked branch `codex/cli-gateway-auth-status` on top of `codex/cli-gateway-profile-use`.
- Scope: expose `GatewayTarget.auth.status()` through a first-class gateway command.
- Added `clip auth <target>` for target auth status.
- Reused the existing target/profile resolution path, including default profiles and explicit `target@profile`.
- Unsupported adapters now report `Gateway adapter "<type>" does not support status`.
- Verification:
  - `bun run check`
  - `git diff --check`
