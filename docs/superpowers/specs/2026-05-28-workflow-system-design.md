# Duru Workflow System Design

## Goal

Build a local-first workflow system for duru that lets humans and agents define, run, inspect, and improve graph-based workflows. A workflow is not limited to an agent skill. It can be a simple deterministic step, a tool call, a sub-workflow, or an agent node with restricted tools and context.

The first version should prioritize a strict runner and observable execution over a full visual editor. The system must prevent agents from reading future step instructions before those steps become runnable.

## Non-Goals

- Do not build a Langflow-compatible clone.
- Do not require a database in the first version.
- Do not expose full workflow internals to an executing agent.
- Do not make `SKILL.md` the workflow source of truth.
- Do not split this into multiple packages at first.

## Package Shape

The first implementation should live monolithically under:

```text
packages/workflow/
  package.json
  src/
    core/
    server/
    studio/
    mcp/
    cli/
```

This keeps schema, loader, runner, API, MCP tools, and Studio types close while the model is still changing. If the boundaries stabilize later, the package can be split into separate workspace packages such as `workflow-core`, `workflow-server`, `workflow-studio`, and `workflow-mcp`.

The existing duru CLI can expose this through a workflow plugin or route, but the implementation should remain owned by `packages/workflow` during the MVP.

## Local File Model

The source of truth is a local workflow directory:

```text
.duru/workflows/
  research-report/
    workflow.json
    steps/
      fetch-api.md
      search-web.md
      write-report.md
    agents/
      researcher.md
      writer.md
    runs/
      2026-05-28T10-30-00Z-run-a1b2/
        run.json
        events.jsonl
        nodes/
          fetch-api.json
          search-web.json
          write-report.json
        artifacts/
          report.md
```

`workflow.json` stores routing metadata only: nodes, edges, entry node, node type, step path, agent path, layout coordinates, and minimal execution policy. It must not store long step instructions.

`steps/*.md` stores node-specific execution instructions. A step file is read only when the runner reaches that node.

`agents/*.md` stores agent-specific policy and prompt material. An agent file is read only for an agent node that is currently runnable.

`runs/<run-id>/events.jsonl` is append-only audit history. `runs/<run-id>/nodes/*.json` stores node status, input, output, timing, error, and measurement data.

## Workflow JSON

Initial schema:

```json
{
  "version": "0.1",
  "entry": "fetch-api",
  "nodes": [
    {
      "id": "fetch-api",
      "type": "tool",
      "title": "Fetch API",
      "step": "steps/fetch-api.md",
      "tool": "gateway.api",
      "position": { "x": 0, "y": 0 }
    },
    {
      "id": "search-web",
      "type": "llm-step",
      "title": "Search Web",
      "step": "steps/search-web.md",
      "position": { "x": 320, "y": 0 }
    },
    {
      "id": "write-report",
      "type": "agent",
      "title": "Write Report",
      "step": "steps/write-report.md",
      "agent": "agents/writer.md",
      "position": { "x": 640, "y": 0 }
    }
  ],
  "edges": [
    { "from": "fetch-api", "to": "search-web" },
    { "from": "search-web", "to": "write-report" }
  ]
}
```

The graph format should stay independent from AI SDK, LangGraph, MCP, or any single model provider. Those integrations are execution adapters.

## Node Types

- `tool`: deterministic call through a registered tool, CLI command, duru gateway target, or API adapter.
- `llm-step`: single LLM step using an adapter such as AI SDK `generateText` or `streamText`.
- `agent`: restricted agent node, potentially using AI SDK agent patterns, with limited tools and isolated context.
- `workflow`: sub-workflow call.
- `condition`: route selection based on previous node outputs.
- `human`: pause for user approval or edited input from Studio.

The runner should support a small subset first: `tool`, `llm-step`, `agent`, and linear edges. Conditions, human gates, and sub-workflows can follow after the run model is stable.

## Execution Contract

The runner owns ordering and context exposure.

1. Load `workflow.json`.
2. Create a run directory.
3. Compute the currently runnable node.
4. Read only that node's `steps/*.md`.
5. For agent nodes, read only that node's `agents/*.md`.
6. Build a step envelope.
7. Execute through the selected adapter.
8. Persist node result and append audit events.
9. Compute the next runnable node.

For a linear `1 -> 2 -> 3` workflow, the executing agent should only receive step `1` at first. Steps `2` and `3` must remain unread by the agent until the runner reaches them.

Step envelope shape:

```json
{
  "runId": "2026-05-28T10-30-00Z-run-a1b2",
  "workflow": "research-report",
  "nodeId": "fetch-api",
  "nodeType": "tool",
  "title": "Fetch API",
  "instructions": "contents of steps/fetch-api.md",
  "inputs": {},
  "previousOutputs": {},
  "allowedTools": ["gateway.api"],
  "expectedOutputSchema": {}
}
```

The envelope is the unit exposed to agents through MCP or CLI. It should not include downstream step instructions.

## Interfaces

CLI commands:

```text
duru workflows list
duru workflows show <name>
duru workflows validate <name>
duru workflows run <name>
duru workflows next <run-id>
duru workflows complete <run-id> <node-id>
duru workflows fail <run-id> <node-id>
duru workflows studio
```

MCP tools:

```text
workflow_list
workflow_start
workflow_next_step
workflow_complete_step
workflow_fail_step
workflow_get_run
workflow_get_events
```

The MCP server and CLI should call the same core runner APIs. They are control surfaces, not separate workflow engines.

## Studio

The Studio should be a local web app backed by Bun, Hono, oRPC, Vite, React, React Flow, shadcn/Base UI, and Tailwind. The first Studio version should be a viewer and run inspector before it becomes a full editor.

MVP Studio views:

- Workflow list.
- React Flow graph viewer.
- Selected node details.
- Step markdown viewer/editor for the selected node.
- Run list.
- Run overlay on graph nodes.
- Event log viewer.
- Node output/error/timing panel.

Studio writes should go through server APIs so validation and audit behavior stay centralized.

## Measurement And Maintenance

Each run should capture enough data to support future step splitting and merging:

- node duration
- status
- error message
- retry count
- input size
- output size
- token usage when available
- tool calls when available
- artifact paths

The first version should not automatically rewrite workflows. It should expose evidence so a person or agent can propose edits.

## Safety

- Validate all paths stay inside the workflow directory.
- Treat `events.jsonl` as append-only.
- Require explicit node completion before advancing.
- Keep downstream instructions hidden from the executing agent.
- Store secrets only by reference, never inline in workflow files or run logs.
- Make destructive edits explicit and auditable.

## MVP Sequence

1. Add `packages/workflow` with schema and local file loader.
2. Add workflow validation for graph shape, missing files, duplicate ids, invalid node types, invalid paths, and basic cycles.
3. Add run directory creation and append-only event logging.
4. Add linear runner that exposes only the current step envelope.
5. Add CLI commands for validate, run, next, complete, and fail.
6. Add MCP tools backed by the same runner.
7. Add local Studio server and React Flow read-only graph viewer.
8. Add run overlay and node/event inspection.
9. Add step editing through server APIs.

## Open Decisions

- Whether the initial runner executes `llm-step` directly or only hands envelopes to external agents.
- Whether workflow directories live only under `.duru/workflows` or also support repo-local `workflows/`.
- Which AI SDK adapter surface should be included in the first version.
- Whether Studio should be launched by `duru workflows studio` only or also by a dev script inside `packages/workflow`.
