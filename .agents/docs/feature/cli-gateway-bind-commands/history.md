# cli-gateway-bind-commands history

- Started stacked branch `codex/cli-gateway-bind-commands` on top of `codex/cli-gateway-auth-status`.
- Scope: restore gateway bind metadata and invocation routing.
- Added `GatewayBindingRecord` and binding methods to `GatewayStore`.
- Added `clip bind <name> <target> [...args]`, `clip binds`, and `clip unbind <name>`.
- Runtime resolves binding names before falling back to host not-found handling, while target names still take precedence over binding names.
- App file store persists bindings under `$CLIP_HOME/gateway/_bindings` and writes shell shims under `$CLIP_HOME/bin`.
- Removing a target also removes bindings that point at that target.
- Verification:
  - `bun run check`
  - `git diff --check`
