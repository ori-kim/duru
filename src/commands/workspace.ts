import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import {
  CONFIG_DIR,
  RESERVED_WORKSPACE_NAMES,
  WORKSPACE_FILE,
  getActiveWorkspace,
  getWorkspaceDir,
  listWorkspaces,
} from "../config.ts";
import { die } from "../utils/errors.ts";

function validateWorkspaceName(name: string): void {
  if (name === "-" || name === "--none") die(`"${name}" is reserved for clearing the active workspace.`);
  if (RESERVED_WORKSPACE_NAMES.has(name)) die(`"${name}" is a reserved name. Choose a different name.`);
  if (name.startsWith(".")) die("Workspace name cannot start with '.'");
  if (name.startsWith("-")) die("Workspace name cannot start with '-'");
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) die("Workspace name may only contain letters, digits, _ and -");
}

export async function runWorkspaceCmd(args: string[]): Promise<void> {
  const sub = args[0];

  if (!sub) {
    const ws = getActiveWorkspace();
    if (ws) {
      console.log(`Active workspace: ${ws}`);
      console.log(`Directory:        ${getWorkspaceDir(ws)}`);
    } else {
      console.log("No active workspace (using global config)");
      console.log(`Global config:    ${CONFIG_DIR}`);
    }
    return;
  }

  if (sub === "list") {
    const active = getActiveWorkspace();
    const workspaces = listWorkspaces();
    const tty = process.stdout.isTTY;
    const bold = (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s);
    const dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s);

    if (!active && workspaces.length === 0) {
      console.log("No workspaces created yet.");
      console.log("\nCreate one: clip workspace new <name>");
      return;
    }

    for (const ws of workspaces) {
      const isActive = ws === active;
      const marker = isActive ? "* " : "  ";
      const name = isActive ? bold(ws) : ws;
      const path = dim(getWorkspaceDir(ws));
      console.log(`${marker}${name}  ${path}`);
    }
    if (active && !workspaces.includes(active)) {
      console.log(`* ${bold(active)}  ${dim("(missing — directory was deleted)")}`);
    }
    if (!active) {
      console.log(dim("\n  (global)  no active workspace"));
    }
    return;
  }

  if (sub === "new") {
    const name = args[1];
    if (!name) die("Usage: clip workspace new <name>");
    validateWorkspaceName(name);
    const wsRoot = getWorkspaceDir(name);
    if (existsSync(wsRoot)) die(`Workspace "${name}" already exists.`);
    mkdirSync(join(wsRoot, "target"), { recursive: true });
    console.log(`Created workspace "${name}"  →  ${wsRoot}`);
    console.log(`Switch to it:  clip workspace use ${name}`);
    return;
  }

  if (sub === "use") {
    const name = args[1];
    if (!name) die("Usage: clip workspace use <name> | clip workspace use -");
    if (name === "-" || name === "--none") {
      mkdirSync(CONFIG_DIR, { recursive: true });
      await Bun.write(WORKSPACE_FILE, "");
      console.log("Cleared active workspace (using global config)");
      return;
    }
    validateWorkspaceName(name);
    const wsRoot = getWorkspaceDir(name);
    if (!existsSync(wsRoot)) {
      die(`Workspace "${name}" does not exist.\nCreate it first: clip workspace new ${name}`);
    }
    mkdirSync(CONFIG_DIR, { recursive: true });
    await Bun.write(WORKSPACE_FILE, name);
    console.log(`Switched to workspace "${name}"`);
    return;
  }

  if (sub === "remove") {
    const name = args[1];
    if (!name || name.startsWith("--")) die("Usage: clip workspace remove <name> [--force]");
    validateWorkspaceName(name);
    const force = args.includes("--force");
    const active = getActiveWorkspace();
    if (active === name) {
      die(`Cannot remove the active workspace "${name}".\nSwitch away first: clip workspace use -`);
    }
    const wsRoot = getWorkspaceDir(name);
    if (!existsSync(wsRoot)) die(`Workspace "${name}" does not exist.`);
    if (!force) {
      die(`This will permanently delete ${wsRoot}\nThis also removes all OAuth tokens and cached API/gRPC/GraphQL specs in this workspace.\nRun again with --force to confirm: clip workspace remove ${name} --force`);
    }
    await Bun.spawn(["rm", "-rf", wsRoot]).exited;
    console.log(`Removed workspace "${name}".`);
    return;
  }

  die(
    `Unknown workspace subcommand: "${sub}"\nUsage: clip workspace [new|use|list|remove]\n\nIf you had a target named "workspace", it is now a reserved command.\nRemove it with: clip remove workspace`,
  );
}
