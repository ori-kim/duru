# Extensions

clip supports a hook-based extension system that lets you add new target types, inject headers, log calls, or short-circuit execution — without modifying clip itself.

Extensions are `.ts` files placed in `~/.clip/extensions/`. clip loads them at startup in alphabetical order.

## Quick start

Create `~/.clip/extensions/trace.ts`:

```ts
import type { ClipExtension } from "../../Documents/personal/clip/types/extension.d.ts";
// or: copy types/extension.d.ts to ~/.clip/extensions/ and import from "./extension.d.ts"

export default {
  name: "my:trace",
  init(api) {
    api.registerHook("toolcall", (ctx) => {
      api.logger.info(`→ ${ctx.targetName} ${ctx.subcommand} ${ctx.args.join(" ")}`);
    });
  },
} satisfies ClipExtension;
```

Then run:

```sh
clip gh pr list
# stderr: [clip] → gh pr list
```

## Lifecycle hooks

Each hook fires at a specific phase. Only one phase allows mutation per call.

| Phase | When | Can return |
|-------|------|-----------|
| `toolcall` | After alias expansion, before ACL check | `void` (observe only) |
| `beforeExecute` | After ACL check, before executor | Modify headers/args/subcommand, or short-circuit |
| `afterExecute` | After executor returns | Partial-merge the result |

### Observe (toolcall)

```ts
api.registerHook("toolcall", (ctx) => {
  console.error(`[audit] ${ctx.targetName}.${ctx.subcommand}`);
});
```

### Inject headers (beforeExecute)

```ts
api.registerHook("beforeExecute", async (ctx) => {
  if (ctx.targetType !== "api") return;
  const token = await fetchToken(api.env["TOKEN_URL"]!);
  return { headers: { Authorization: `Bearer ${token}` } };
});
```

### Short-circuit (beforeExecute)

```ts
api.registerHook("beforeExecute", (ctx) => {
  if (ctx.dryRun) {
    return { shortCircuit: { exitCode: 0, stdout: "[dry-run] skipped", stderr: "" } };
  }
});
```

### Rewrite result (afterExecute)

```ts
api.registerHook("afterExecute", (ctx) => {
  if (!ctx.result) return;
  return { result: { stdout: ctx.result.stdout.replace(/secret=\S+/g, "secret=***") } };
});
```

### Filter by type / target / subcommand

```ts
api.registerHook("beforeExecute", injectAuth, {
  match: { type: ["api", "graphql"], target: [/^prod-/] },
});
```

## Register a new target type

Extensions can add entirely new target types backed by a config schema.

```ts
// ~/.clip/extensions/sqlite.ts
import { z } from "zod";
import type { ClipExtension } from "./extension.d.ts";

const schema = z.object({
  file: z.string(),
  readOnly: z.boolean().default(false),
});

export default {
  name: "builtin-user:sqlite",
  init(api) {
    api.registerTargetType({
      type: "sqlite",
      schema,
      async executor(target, ctx) {
        if (ctx.subcommand !== "query") {
          return { exitCode: 1, stdout: "", stderr: `Unknown subcommand: ${ctx.subcommand}` };
        }
        const sql = ctx.args.join(" ");
        const flags = target.readOnly ? ["--readonly"] : [];
        const proc = Bun.spawn(["sqlite3", ...flags, target.file, sql]);
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        return { exitCode: await proc.exited, stdout, stderr };
      },
    });
  },
} satisfies ClipExtension;
```

Register a target using the new type:

```yaml
# ~/.clip/target/sqlite/mydb/config.yml
file: ~/data/mydb.sqlite
readOnly: true
```

```sh
clip mydb query "SELECT * FROM users LIMIT 5"
```

## Error handlers

```ts
api.registerErrorHandler(async (ctx) => {
  if (ctx.aclDenied) return; // let ACL denials propagate
  await reportToSlack(`clip error in ${ctx.targetName}: ${ctx.error}`);
  // return nothing → rethrow original
});
```

## Hook priority

Lower priority number runs first in `beforeExecute` / `toolcall`, and last in `afterExecute` (onion model).

```ts
api.registerHook("beforeExecute", injectTokenA, { priority: 10 });
api.registerHook("beforeExecute", injectTokenB, { priority: 20 }); // runs after A
```

When multiple hooks return `headers`, they are merged (last writer wins per key).

## Lifecycle

```
init()  →  [toolcall hook]  →  [beforeExecute hook]  →  executor  →  [afterExecute hook]  →  result
                                                                                ↓
                                                              [errorHandler on throw]
dispose()  ←  SIGINT / beforeExit
```

## Disabling extensions

Set `CLIP_NO_EXTENSIONS=1` to skip loading `~/.clip/extensions/`. Built-in target types still load.

```sh
CLIP_NO_EXTENSIONS=1 clip gh pr list
```

## TypeScript types

Public types are in `types/extension.d.ts` in the clip repo. Copy the file to your extensions directory for local type checking:

```sh
cp "$(dirname $(which clip))/../lib/clip/types/extension.d.ts" ~/.clip/extensions/
```
