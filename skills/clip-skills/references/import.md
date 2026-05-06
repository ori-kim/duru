# Import External Clip Skills

Use this reference when importing an external skill directory into the clip registry.

## Pull

`pull` moves an external directory into the registry and creates a reverse symlink at the original path.

```sh
clip skills pull ~/dotfiles/skills/my-skill
```

Result:

```text
real files: ~/.clip/skills/my-skill/
symlink:    ~/dotfiles/skills/my-skill -> ~/.clip/skills/my-skill
```

Optional second argument overrides the registry name:

```sh
clip skills pull ~/dotfiles/skills/my-skill renamed-skill
```

## After Import

```sh
clip skills list
clip skills show renamed-skill
clip skills install renamed-skill --to codex
```

If the original path is under source control, confirm that replacing it with a symlink is acceptable before running `pull`.
