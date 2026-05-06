# Install And Package Clip Extensions

Use this reference when installing, updating, uninstalling, or preparing a clip extension for GitHub installation.

## Install From GitHub

Install from a repo extension index:

```sh
clip ext install github:owner/repo
clip ext install github:owner/repo --all --yes
clip ext install github:owner/repo --select myext --yes
```

Install from a specific folder:

```sh
clip ext install github:owner/repo --dir extensions/myext --yes
clip ext install https://github.com/owner/repo/tree/main/extensions/myext --yes
```

Update from recorded install metadata:

```sh
clip ext update <name>
clip ext update <name> --ref <branch-or-sha> --yes
```

Uninstall:

```sh
clip ext uninstall <name> --yes
```

## Repo Extension Index

An installable repo can expose `.clip/extension-index.yaml`:

```yaml
extensions:
  - name: myext
    dir: extensions/myext
    description: Adds clip myext command
```

For backward compatibility, `.clip/extensions.yaml`, `.clip/extensions.yml`, `.clip/extensions.json`, `clip/extensions.yaml`, `clip/extensions.yml`, and `clip/extensions.json` are also accepted as repo-level index paths.

If an index has multiple extensions, `clip ext install github:owner/repo` opens an interactive selector. In automation, always pass `--all --yes`, `--select <name> --yes`, or `--dir <path> --yes`.

## Extension Metadata

Each installable extension folder should include `clip/extension.yaml`:

```yaml
name: myext
version: 0.1.0
entry: src/extension.ts
contributes:
  internalCommands: [myext]
  targetTypes: []
  hooks: []
runtime:
  dependencies: {}
```

Use `runtime.dependencies` for packages required at runtime. `@clip/core`, `zod`, and `yaml` are virtual modules available from clip itself, so do not add them unless the extension needs package-manager metadata for editor support.

## What The Installer Does

`clip ext install`:

1. Copies the selected GitHub folder into `$CLIP_HOME/extensions/<name>/`.
2. Writes `$CLIP_HOME/extensions/<name>/.clip-install.json`.
3. Creates a runtime `package.json` from `runtime.dependencies`.
4. Runs `npm install --omit=dev` when dependencies exist.
5. Adds or updates `~/.clip/extensions/extensions.yml` with `path: <name>`.

The manifest points at the installed runtime copy, not the source checkout:

```yaml
extensions:
  - name: myext
    path: myext
    entry: src/extension.ts
    contributes:
      internalCommands: [myext]
      targetTypes: []
      hooks: []
```

## Packaging Checklist

Before publishing an extension:

1. Ensure `clip/extension.yaml` exists in the extension folder.
2. Ensure repo-level `.clip/extension-index.yaml` lists the extension if installing from index.
3. Keep `contributes` in metadata aligned with implementation.
4. Keep runtime dependencies minimal.
5. Test install into a clean `$CLIP_HOME` when possible.
6. Run `clip ext info <name>` after installation to verify source metadata.
