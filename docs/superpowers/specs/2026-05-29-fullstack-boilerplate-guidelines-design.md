# Fullstack Boilerplate Architecture Guidelines

## Goal

Define a TypeScript fullstack boilerplate that lets humans and agents work from deterministic file paths. A file's path should identify the canonical spec snippet it owns: schemas live in one place, query options live in one place, scenario composition lives in one place, and framework routes only connect the framework to views.

The first version should stay a single application. A monorepo can come later when two or more deployable apps need to share stable platform packages.

## Non-Goals

- Do not start with a multi-app monorepo.
- Do not put product-specific domain code in `shared`.
- Do not let `usecase` own schemas, contracts, server procedures, repositories, query options, or mutation options.
- Do not make generated API clients the human-reviewed source of truth.
- Do not use route files as a place for product logic.

## Source Shape

Initial single-app shape:

```text
src/
  shared/
  platform/
  integration/
  feature/
  usecase/
  view/
  app/ or routes/
```

`shared` is pure shared code. It can contain base UI, date utilities, timestamp helpers, `Result` helpers, formatting helpers, and generic functions. It must not import from `platform`, `feature`, `usecase`, `view`, or routes.

`platform` is app runtime glue. It can contain providers, auth binding, env parsing, query client setup, API root composition, logging setup, framework-specific adapters, and deploy/runtime helpers. This layer exists so app-aware code does not leak into `shared`.

`integration` is optional. Use it only for external-system adapters or generated clients that span multiple features. If an external API belongs to one domain, keep it under that feature instead.

`feature` owns headless domain capability and domain primitives.

`usecase` owns scenario-level composition components. It composes feature headless hooks, query options, mutation options, and UI primitives for a specific user scenario.

`view` owns screen layout. It places usecase sections into a page-sized composition and owns screen-level pending, empty, and error states.

`app` or `routes` is the framework adapter. Route files import views, pass route params/search params, and expose framework metadata. They should not contain business logic.

## Layer Definitions

```text
feature = headless capability + domain primitives
usecase = feature capability composed into scenario sections/components
view = usecase sections arranged into screens
route = framework adapter
```

`usecase` is not a business-logic layer. It is a scenario composition layer.

## Feature Convention

Each domain or entity has a canonical feature folder:

```text
src/feature/todo-item/
  entity/
    schema.ts
    selectors.ts
    mapper.ts
    identity.ts
  client/
    query-options.ts
    mutation-options.ts
    hooks.ts
    form.tsx
    state.ts
  server/
    router.ts
    service.ts
    repository.ts
    integration.ts
  ui/
    title-field.tsx
    status-badge.tsx
    submit-button.tsx
  integration/
    todo-api/
      generated/
      mapper.ts
      client.ts
  index.ts
```

`entity/schema.ts` owns Zod schemas and inferred domain types.

`entity/selectors.ts` owns pure derived domain logic.

`entity/mapper.ts` owns response-to-domain mapping when the mapping is part of the domain language.

`entity/identity.ts` owns stable identifiers such as query key seeds, entity id helpers, and display identity helpers.

`client/query-options.ts` owns TanStack Query query options. With oRPC, this file should usually wrap inferred `.queryOptions()` calls rather than define request logic.

`client/mutation-options.ts` owns mutation options.

`client/hooks.ts` owns headless domain hooks when the hook is reusable across scenarios.

`client/form.tsx` owns headless form providers and form hooks. It can wire React Hook Form to feature schemas, but it should not decide a specific scenario's layout or toast behavior.

`client/state.ts` owns reusable feature-level client state. Scenario-only transient state should stay inside usecase components unless it becomes reusable feature capability.

`server/router.ts` owns oRPC/tRPC procedure definitions or route-level server contract bindings for the feature.

`server/service.ts` owns domain server operations.

`server/repository.ts` owns database access for the feature.

`server/integration.ts` owns server-side external API wiring that belongs to the feature.

`ui/*` owns domain UI primitives. These components should be composable, headless-friendly, and unaware of routes. They should not perform framework navigation or define query options.

`integration/{provider}/generated` is generated code and is not the canonical human-reviewed spec snippet.

## Usecase Convention

Usecase folders contain React composition components only:

```text
src/usecase/create-todo-form/
  form-section.tsx
  title-field.tsx
  submit-button.tsx
  validate-toast.tsx
  success-toast.tsx
  index.ts
```

Allowed in `usecase`:

- Components that compose feature headless hooks, feature query options, feature mutation options, and feature UI primitives.
- Component-local props and helper types.
- Scenario-only UI state inside component files.
- Scenario-specific dialog, toast, and section composition.

Forbidden in `usecase`:

```text
usecase/create-todo-form/schema.ts
usecase/create-todo-form/model.ts
usecase/create-todo-form/contract.ts
usecase/create-todo-form/query-options.ts
usecase/create-todo-form/mutation-options.ts
usecase/create-todo-form/service.ts
usecase/create-todo-form/router.ts
usecase/create-todo-form/repository.ts
```

Example:

```tsx
import { TodoItemMutationOptions } from "@/feature/todo-item/client/mutation-options";
import { TodoSubmitButton } from "@/feature/todo-item/ui/submit-button";

export function SubmitButton() {
  return <TodoSubmitButton mutationOptions={TodoItemMutationOptions.create()} />;
}
```

The usecase file decides which feature capability is used for this scenario. It does not create new domain contracts.

## View Convention

Views arrange usecase sections into full screens:

```text
src/view/todo-list/
  view.tsx
  boundary.tsx
  pending.tsx
  empty.tsx
  error.tsx
  index.ts
```

`view.tsx` should import usecase sections and shared/platform layout primitives. It should not define domain schemas, query options, mutation options, or server calls.

Screen-level loading, empty, and error states live in `view`. Section-specific states live next to the relevant usecase component.

## Route Convention

Framework routes are adapters:

```text
src/app/todos/page.tsx
src/app/todos/[id]/page.tsx
```

or for file-router frameworks:

```text
src/routes/todos.tsx
src/routes/todos.$id.tsx
```

Routes may:

- Read route params and search params.
- Export framework metadata.
- Import and render a view.
- Bridge framework loader/server function APIs into platform adapters when the framework requires it.

Routes may not:

- Define product schemas.
- Define query options or mutation options.
- Call repositories directly.
- Contain scenario composition.
- Contain UI sections beyond framework-required shells.

## Platform Convention

`platform` absorbs code that is shared across the app but not pure enough for `shared`:

```text
src/platform/
  api/
    root-router.ts
    client.ts
    context.ts
    errors.ts
  auth/
    server.ts
    client.tsx
  env/
    schema.ts
    server.ts
    client.ts
  providers/
    app-providers.tsx
    query-provider.tsx
  runtime/
    logger.ts
    get-base-url.ts
```

Use `platform` for app-wide runtime composition, framework-aware providers, auth, API clients, root router composition, env binding, and deploy/runtime helpers.

The key rule: if code needs to know about the app runtime, it is not `shared`.

## Integration And Generated Code

Generated clients are build artifacts:

```text
src/feature/karavan/topic/integration/karavan-api/generated/
```

or, if the integration spans features:

```text
src/integration/karavan-api/generated/
```

Human-reviewed adapters should wrap generated clients from deterministic paths:

```text
src/feature/karavan/topic/client/query-options.ts
src/feature/karavan/topic/entity/mapper.ts
src/feature/karavan/topic/server/integration.ts
```

Generated files should not be imported directly from views or usecases unless a project explicitly allows a short-term migration exception.

## Ambiguity Rules

External API response conversion:

- Domain-language conversion goes in `feature/{domain}/entity/mapper.ts`.
- Provider-specific conversion goes in `feature/{domain}/integration/{provider}/mapper.ts` or `src/integration/{provider}/mapper.ts`.

URL search params:

- Reusable domain filters go in `feature/{domain}/client/state.ts` or `feature/{domain}/client/query-options.ts`.
- Scenario-only UI state stays inside usecase component files.
- Route parsing stays in routes only when the framework requires route-level parsing, then passes normalized values into views.

Skeleton, empty, and error states:

- Screen-wide states live in `view/{screen}`.
- Section-specific states live in `usecase/{scenario}`.
- Domain primitive states live in `feature/{domain}/ui`.

Cross-feature UI reuse:

- If multiple domains should reuse a primitive, move it to `shared/ui`.
- Otherwise feature-to-feature imports are not allowed.

Proxy routes:

- Route files own framework proxy handlers only.
- Proxy configuration belongs in `feature/{domain}/server/integration.ts` or `platform/api`.

Tests:

- Test pure domain code next to the file under test.
- Test usecase component composition next to the usecase.
- Test view-level state next to the view.
- Keep generated client tests out of human-authored spec review unless testing a wrapper.

Barrel exports:

- `index.ts` may expose public symbols for ergonomics.
- `index.ts` must not contain logic.
- Avoid feature-root wildcard barrels that hide canonical file ownership.

## Dependency Rules

Allowed dependency direction:

```text
route -> view -> usecase -> feature -> shared
platform -> shared
platform/api -> feature/server
```

`shared` imports nothing above it.

`feature` does not import from `usecase`, `view`, or routes.

`usecase` does not import from `view` or routes.

`view` does not import server repositories or define feature contracts.

Client code must not import server-only files. Server code must not import client-only components.

## Quality Gates

The boilerplate should provide one command for local and CI verification:

```text
pnpm check
```

`pnpm check` should run, at minimum:

- format check
- lint
- typecheck
- unit tests
- boundary inspection
- React-specific static checks when available

Recommended scripts:

```json
{
  "scripts": {
    "format": "biome check --write .",
    "format:check": "biome check .",
    "lint": "biome check .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "doctor": "react-doctor --diff --fail-on warning",
    "check:boundaries": "repo-boundary-check",
    "check": "pnpm format:check && pnpm typecheck && pnpm test && pnpm check:boundaries"
  }
}
```

The exact tools can change by project, but the policy should remain stable.

## Merge Review Policy

A change is merge-ready only when:

- All required checks pass.
- The changed files live in the canonical paths for the concepts they modify.
- Generated files are separated from human-authored wrappers.
- Route files remain thin adapters.
- Usecase files contain scenario composition only.
- Shared code remains domain-free.
- New cross-feature reuse is either moved to `shared` or explicitly rejected.
- Database migrations, environment changes, and public API changes are called out in the PR.

## Deploy Review Policy

Deployment review should classify changes before release:

```text
changed apps/screens
changed features
changed platform runtime
changed env schema
changed database schema
changed public API
changed generated clients
risk level
required smoke tests
required owners
```

The review should be generated from file paths first, then refined by a human or agent.

## Agent Workflow

When an agent changes the app, it should:

1. Identify the concept being changed.
2. Map that concept to its canonical path.
3. Edit only the smallest owning snippet.
4. Add or update the nearest relevant test.
5. Run the relevant check command.
6. Summarize changed snippets by canonical path.

The agent should not search for "where to put code" by taste. The architecture should answer that from the path rules.

## Monorepo Later

When two or more deployable apps exist, split stable platform code into packages:

```text
packages/
  shared/
  ui/
  platform-api/
  platform-env/
  config/
  testing/
```

App-specific `feature`, `usecase`, `view`, and routes should stay inside each app until a domain proves it is stable and shared across apps.

Do not extract app-local domains into packages only because a monorepo exists.
