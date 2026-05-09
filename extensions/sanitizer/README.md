# clip sanitizer extension

Optional `target-end` hook that redacts sensitive-looking output and warns on prompt-injection text.

Example manifest entry:

```yaml
extensions:
  - name: sanitizer
    path: /path/to/clip/extensions/sanitizer/src
    entry: extension.ts
    contributes:
      hooks: [target-end]
```

For passthrough CLI targets, use `--pipe` when you need captured output to be sanitized.
