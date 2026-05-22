# @clip/config Design

Date: 2026-05-22
Status: Draft for review

## Purpose

`@clip/config` provides home directory, layout, and file-store primitives for Clip packages. It does not know about targets, profiles, protocol adapters, commands, plugin manifests, auth, or gateway semantics. Domain packages use it to place, read, and write their own files consistently under the Clip home.

The package is intentionally boring: it is the shared filesystem substrate that keeps every feature from reimplementing `CLIP_HOME`, directory creation, safe relative paths, structured file IO, and atomic writes.

## Goals

- Resolve the effective Clip home from explicit options, `CLIP_HOME`, or a default home directory.
- Provide scoped stores so packages can own their own layout without a central domain schema.
- Provide safe path helpers that reject path traversal and absolute paths where a relative store path is expected.
- Provide small read/write helpers for text, JSON, YAML, binary data, directory listing, existence checks, and removal.
- Use atomic writes for config/state files to avoid partial writes.
- Make tests deterministic by allowing an explicit home path and environment object.
- Keep target config, plugin manifests, auth tokens, profiles, and command semantics out of this package.

## Non-Goals

- No target registry or target config schema.
- No plugin or extension manifest schema.
- No command registration.
- No protocol execution.
- No auth flow or token refresh.
- No global migration framework in the first version.
- No secret storage policy beyond file IO primitives. Packages that handle tokens must choose their own secure storage behavior.

## Concepts

### ClipHome

`ClipHome` represents the resolved root directory for Clip state.

```ts
type ClipHome = {
  root: string;
  resolve(path?: string): string;
  scope(name: string): ClipStore;
  store(path?: string): ClipStore;
};
```

`resolve()` returns a path under the home root. `scope(name)` creates a namespaced store under `root/name`. `store(path)` creates a store at any safe relative path under the root. This lets domain packages choose whether they want a namespaced layout such as `cli-gateway/targets` or a compatibility layout such as `target/cli/test-service`.

### ClipStore

`ClipStore` is a filesystem helper rooted at a directory.

```ts
type ClipStore = {
  root: string;
  resolve(path?: string): string;
  ensureDir(path?: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(path?: string): Promise<readonly ClipDirEntry[]>;
  readText(path: string): Promise<string | undefined>;
  writeText(path: string, value: string, options?: WriteOptions): Promise<void>;
  readJson<T = unknown>(path: string): Promise<T | undefined>;
  writeJson(path: string, value: unknown, options?: WriteOptions): Promise<void>;
  readYaml<T = unknown>(path: string): Promise<T | undefined>;
  writeYaml(path: string, value: unknown, options?: WriteOptions): Promise<void>;
  readBytes(path: string): Promise<Uint8Array | undefined>;
  writeBytes(path: string, value: Uint8Array, options?: WriteOptions): Promise<void>;
  remove(path: string, options?: RemoveOptions): Promise<void>;
};
```

Missing files return `undefined` for read helpers. Parse errors include the resolved path and parser name. Write helpers create parent directories.

## Public API

```ts
type CreateClipHomeOptions = {
  home?: string;
  env?: Readonly<Record<string, string | undefined>>;
  defaultHome?: string;
};

declare function createClipHome(options?: CreateClipHomeOptions): ClipHome;
declare function createClipStore(root: string): ClipStore;
declare function assertSafeStorePath(path: string): void;
```

`home` wins over `env.CLIP_HOME`; `env.CLIP_HOME` wins over `defaultHome`; `defaultHome` defaults to the user's home plus `.clip`.

The package may also export errors:

```ts
class ClipConfigPathError extends Error {}
class ClipConfigParseError extends Error {}
class ClipConfigWriteError extends Error {}
```

## Layout Policy

`@clip/config` does not reserve most directory names. It only defines path behavior.

Recommended ownership:

- `cli-gateway/` or `target/`: owned by `@clip/cli-gateway`.
- `plugins/` or `extensions/`: owned by the app plugin manager package.
- `cache/`: packages may create a scoped cache subdirectory.
- `state/`: packages may create a scoped state subdirectory.

For compatibility with the current product, `@clip/cli-gateway` can choose to keep existing target paths:

```text
$CLIP_HOME/target/<type>/<name>/config.yml
$CLIP_HOME/target/<type>/<name>/.env
```

That compatibility decision belongs to `@clip/cli-gateway`, not `@clip/config`.

## Example Usage

```ts
import { createClipHome } from "@clip/config";

const home = createClipHome({ env: process.env });
const gatewayStore = home.store("target");

await gatewayStore.writeYaml("cli/test-service/config.yml", {
  command: "test-service",
  timeoutMs: 30000,
});

const target = await gatewayStore.readYaml("cli/test-service/config.yml");
```

## Error Handling

- Unsafe paths throw before touching the filesystem.
- Reads return `undefined` only when a file does not exist.
- Parse failures throw `ClipConfigParseError`.
- Writes use a temp file and rename into place. A failed write must not leave a partial destination file.
- Remove defaults to file-only behavior unless recursive removal is explicitly requested.

## Testing

Unit tests should cover:

- Home resolution precedence.
- Safe path rejection for absolute paths, `..`, and empty invalid segments.
- Missing file reads.
- JSON and YAML round trips.
- Parent directory creation.
- Atomic write behavior at the API level.
- Scoped store path resolution.
- Deterministic behavior with a temporary test home.

## Adoption Plan

1. Add `@clip/config` with only path and file-store primitives.
2. Migrate new packages to use `createClipHome()` instead of reading `CLIP_HOME` directly.
3. Keep existing product layouts owned by their feature packages.
4. Add migration helpers later only when a domain package has a concrete migration need.

## Open Decisions

- YAML support can be built in because the existing product uses YAML heavily. If dependency weight becomes a concern, YAML helpers can move behind a codec registration API.
- File locking is not included in the first version. Atomic writes are enough for current local CLI workflows.
