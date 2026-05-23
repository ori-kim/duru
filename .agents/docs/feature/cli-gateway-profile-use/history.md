# cli-gateway-profile-use history

- Started stacked branch `codex/cli-gateway-profile-use` on top of `codex/cli-gateway-openapi-discovery`.
- Scope: add default profile selection to the GatewayTarget runtime without changing adapter contracts.
- Added `GatewayTargetRecord.defaultProfile`.
- Added `clip profile use <target> <name>` and `clip profile unset <target>`.
- `profile list` now marks the active profile with `active: true`.
- Runtime, inspect, login, and logout now resolve an explicit `target@profile` first, then the target default profile.
- File-backed target updates now preserve existing profiles and aliases when only the target config file is rewritten.
- Grouped API/OpenAPI adapter implementation under `packages/cli-gateway/src/adapters/api/` because the adapter folder crossed the 10-file threshold.
- Verification:
  - `bun run check`
