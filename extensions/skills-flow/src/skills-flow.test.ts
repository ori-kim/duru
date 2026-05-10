import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClipError } from "@clip/core";
import { runSkillsFlowCmd, validateSkillsFlowPackage } from "./skills-flow.ts";
import { buildWebPayload, mergeFlowUi, parseWebArgs, readFlowUi } from "./web.ts";

async function withClipHome(fn: (home: string) => Promise<void> | void): Promise<void> {
  const oldHome = process.env.CLIP_HOME;
  const home = mkdtempSync(join(tmpdir(), "clip-skills-flow-test-"));
  process.env.CLIP_HOME = home;
  try {
    await fn(home);
  } finally {
    if (oldHome === undefined) process.env.CLIP_HOME = undefined;
    else process.env.CLIP_HOME = oldHome;
    rmSync(home, { recursive: true, force: true });
  }
}

describe("skills-flow create", () => {
  test("creates an empty valid flow package", async () => {
    await withClipHome(async (home) => {
      await runSkillsFlowCmd(["create", "demo", "--description", "Demo skill"]);

      const dir = join(home, "skills-flow", "demo");
      expect(existsSync(join(dir, "SKILL.md"))).toBe(true);
      expect(existsSync(join(dir, "flow.json"))).toBe(true);

      const flow = JSON.parse(readFileSync(join(dir, "flow.json"), "utf8"));
      expect(flow).toEqual({
        schemaVersion: "1",
        name: "demo",
        nodes: [],
        edges: [],
      });

      const result = validateSkillsFlowPackage(dir);
      expect(result.valid).toBe(true);
      expect(result.status).toBe("valid");
    });
  });

  test("merges frontmatter file and key-value fields while preserving required CLI fields", async () => {
    await withClipHome(async (home) => {
      const fmFile = join(home, "frontmatter.yml");
      writeFileSync(
        fmFile,
        ["name: wrong-name", "description: wrong description", "allowed-tools:", "  - Read", "  - Write"].join("\n"),
      );

      await runSkillsFlowCmd([
        "create",
        "demo",
        "--description",
        "Demo skill",
        "--frontmatter-file",
        fmFile,
        "--frontmatter",
        "model=gpt-5.2",
      ]);

      const skill = readFileSync(join(home, "skills-flow", "demo", "SKILL.md"), "utf8");
      expect(skill).toContain("name: demo");
      expect(skill).toContain("description: Demo skill");
      expect(skill).toContain("allowed-tools:");
      expect(skill).toContain("model: gpt-5.2");
    });
  });

  test("fails on existing package unless --force is used", async () => {
    await withClipHome(async () => {
      await runSkillsFlowCmd(["create", "demo", "--description", "Demo skill"]);
      await expect(runSkillsFlowCmd(["create", "demo", "--description", "Demo skill"])).rejects.toThrow(ClipError);
      await runSkillsFlowCmd(["create", "demo", "--description", "Recreated", "--force"]);
    });
  });
});

describe("skills-flow validation", () => {
  test("reports graph integrity errors", () => {
    const home = mkdtempSync(join(tmpdir(), "clip-skills-flow-test-"));
    try {
      const dir = join(home, "broken");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "SKILL.md"),
        ["---", "name: broken", "description: Broken skill", "---", "", "# broken"].join("\n"),
      );
      writeFileSync(
        join(dir, "flow.json"),
        JSON.stringify(
          {
            schemaVersion: "1",
            name: "broken",
            entryNode: "start",
            nodes: [{ id: "start", type: "start", name: "Start", link: "steps/start.md" }],
            edges: [{ id: "to-missing", from: "start", to: "missing", type: "next", name: "Next" }],
          },
          null,
          2,
        ),
      );

      const result = validateSkillsFlowPackage(dir);
      expect(result.valid).toBe(false);
      expect(result.errors.map((issue) => issue.code)).toContain("node.link.missing");
      expect(result.errors.map((issue) => issue.code)).toContain("edge.to_missing");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("accepts a non-empty graph when links and references are valid", () => {
    const home = mkdtempSync(join(tmpdir(), "clip-skills-flow-test-"));
    try {
      const dir = join(home, "valid-flow");
      mkdirSync(join(dir, "steps"), { recursive: true });
      writeFileSync(
        join(dir, "SKILL.md"),
        ["---", "name: valid-flow", "description: Valid flow", "---", "", "# valid-flow"].join("\n"),
      );
      writeFileSync(join(dir, "steps", "start.md"), "# Start\n");
      writeFileSync(
        join(dir, "flow.json"),
        JSON.stringify(
          {
            schemaVersion: "1",
            name: "valid-flow",
            entryNode: "start",
            nodes: [{ id: "start", type: "start", name: "Start", link: "steps/start.md" }],
            edges: [],
          },
          null,
          2,
        ),
      );

      const result = validateSkillsFlowPackage(dir);
      expect(result.valid).toBe(true);
      expect(result.status).toBe("valid");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("skills-flow web", () => {
  test("parses web args", () => {
    expect(parseWebArgs([])).toEqual({
      name: undefined,
      host: "127.0.0.1",
      port: 3907,
      portWasExplicit: false,
    });
    expect(parseWebArgs(["demo"])).toEqual({
      name: "demo",
      host: "127.0.0.1",
      port: 3907,
      portWasExplicit: false,
    });
    expect(parseWebArgs(["demo", "--host", "0.0.0.0", "--port", "0"])).toEqual({
      name: "demo",
      host: "0.0.0.0",
      port: 0,
      portWasExplicit: true,
    });
  });

  test("builds web payload from a valid package", async () => {
    await withClipHome(async (home) => {
      await runSkillsFlowCmd(["create", "demo", "--description", "Demo skill"]);
      const dir = join(home, "skills-flow", "demo");
      const result = validateSkillsFlowPackage(dir);
      const payload = buildWebPayload(
        "demo",
        dir,
        result,
        [
          {
            id: "demo",
            name: "demo",
            dir,
            description: "Demo skill",
            status: result.status,
            valid: result.valid,
            nodes: 0,
            edges: 0,
          },
        ],
        join(home, "skills-flow"),
      );
      expect(payload.name).toBe("demo");
      expect(payload.description).toBe("Demo skill");
      expect(payload.selectedId).toBe("demo");
      expect(payload.packages).toHaveLength(1);
      expect(payload.validation.valid).toBe(true);
      expect(payload.flowUi).toEqual({ schemaVersion: "1", nodePositions: {} });
    });
  });

  test("persists canvas positions in flow-ui.json by node id", async () => {
    await withClipHome(async (home) => {
      await runSkillsFlowCmd(["create", "demo", "--description", "Demo skill"]);
      const dir = join(home, "skills-flow", "demo");

      expect(readFlowUi(dir)).toEqual({ schemaVersion: "1", nodePositions: {} });
      mergeFlowUi(dir, {
        nodePositions: {
          start: {
            horizontal: { x: 120, y: 240 },
          },
        },
      });
      const saved = mergeFlowUi(dir, {
        nodePositions: {
          start: {
            vertical: { x: 320, y: 90 },
          },
        },
      });

      expect(saved.nodePositions.start?.horizontal).toEqual({ x: 120, y: 240 });
      expect(saved.nodePositions.start?.vertical).toEqual({ x: 320, y: 90 });
      expect(JSON.parse(readFileSync(join(dir, "flow-ui.json"), "utf8"))).toEqual(saved);
    });
  });
});
