import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "@duru/file-store";
import { createMemoryStore, parseDuration } from "./store.ts";

describe("createMemoryStore", () => {
  test("adds markdown memory items with frontmatter and deterministic ids", async () => {
    const home = await tempHome();
    const now = new Date("2026-05-27T03:04:05.000Z");
    const store = createMemoryStore(createFileStore({ root: home }), { now: () => now, timeZone: "Asia/Seoul" });

    const item = await store.add("skills are shared separately from memory", { tags: ["skills", "memory", "skills"] });

    expect(item.meta).toEqual({
      id: "20260527-120405-skills-are-shared-separately-from-memory",
      tags: ["skills", "memory"],
      createdAt: "2026-05-27T12:04:05+09:00",
      updatedAt: "2026-05-27T12:04:05+09:00",
    });
    expect(item.body).toBe("skills are shared separately from memory");

    const raw = await readFile(join(home, "items", "2026-05-27", `${item.meta.id}.md`), "utf8");
    expect(raw).toContain("id: 20260527-120405-skills-are-shared-separately-from-memory");
    expect(raw).toContain("tags: [skills, memory]");
    expect(raw).toContain("skills are shared separately from memory");

    await expect(store.get(item.meta.id)).resolves.toMatchObject({ body: item.body, meta: item.meta });
  });

  test("reads legacy flat memory items by id", async () => {
    const home = await tempHome();
    const store = createMemoryStore(createFileStore({ root: home }), {
      now: () => new Date("2026-05-27T03:04:05.000Z"),
      timeZone: "Asia/Seoul",
    });
    const id = "20260527-120405-legacy-memory";

    await mkdir(join(home, "items"), { recursive: true });
    await writeFile(
      join(home, "items", `${id}.md`),
      [
        "---",
        `id: ${id}`,
        "tags: []",
        "createdAt: 2026-05-27T12:04:05+09:00",
        "updatedAt: 2026-05-27T12:04:05+09:00",
        "---",
        "",
        "legacy body",
        "",
      ].join("\n"),
    );

    await expect(store.get(id)).resolves.toMatchObject({
      body: "legacy body",
      path: join(home, "items", `${id}.md`),
    });
  });

  test("show updates usage without rewriting item frontmatter", async () => {
    const home = await tempHome();
    let current = new Date("2026-05-27T03:04:05.000Z");
    const store = createMemoryStore(createFileStore({ root: home }), { now: () => current, timeZone: "Asia/Seoul" });
    const item = await store.add("usage belongs outside frontmatter");
    const itemFile = join(home, "items", "2026-05-27", `${item.meta.id}.md`);
    const before = await readFile(itemFile, "utf8");

    current = new Date("2026-05-27T03:05:06.000Z");
    const shown = await store.show(item.meta.id);
    const usageLog = await readFile(join(home, "usage", "2026-05-27.jsonl"), "utf8");
    const usageEvents = usageLog
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(shown?.body).toBe("usage belongs outside frontmatter");
    expect(await readFile(itemFile, "utf8")).toBe(before);
    expect(usageEvents).toEqual([
      {
        action: "show",
        id: item.meta.id,
        accessedAt: "2026-05-27T12:05:06+09:00",
      },
    ]);
    expect(await store.usage()).toEqual({
      items: {
        [item.meta.id]: {
          accessCount: 1,
          lastAccessedAt: "2026-05-27T12:05:06+09:00",
        },
      },
    });
  });

  test("aggregates legacy usage.json with partitioned usage events", async () => {
    const home = await tempHome();
    const files = createFileStore({ root: home });
    const store = createMemoryStore(files, {
      now: () => new Date("2026-05-27T03:04:05.000Z"),
      timeZone: "Asia/Seoul",
    });
    const item = await store.add("legacy usage compatibility");

    await files.write("usage.json", {
      items: {
        [item.meta.id]: {
          accessCount: 2,
          lastAccessedAt: "2026-05-26T12:00:00+09:00",
        },
      },
    });
    await store.show(item.meta.id);

    expect(await store.usage()).toEqual({
      items: {
        [item.meta.id]: {
          accessCount: 3,
          lastAccessedAt: "2026-05-27T12:04:05+09:00",
        },
      },
    });
  });

  test("updates tags by replacement or patch and refreshes updatedAt", async () => {
    const home = await tempHome();
    let current = new Date("2026-05-27T03:04:05.000Z");
    const store = createMemoryStore(createFileStore({ root: home }), { now: () => current, timeZone: "Asia/Seoul" });
    const item = await store.add("taggable memory", { tags: ["alpha"] });

    current = new Date("2026-05-27T04:00:00.000Z");
    const replaced = await store.updateTags(item.meta.id, { tags: ["beta", "gamma", "beta"] });
    expect(replaced.meta.tags).toEqual(["beta", "gamma"]);
    expect(replaced.meta.updatedAt).toBe("2026-05-27T13:00:00+09:00");

    current = new Date("2026-05-27T05:00:00.000Z");
    const patched = await store.updateTags(item.meta.id, { add: ["delta"], remove: ["beta"] });
    expect(patched.meta.tags).toEqual(["gamma", "delta"]);
    expect(patched.meta.updatedAt).toBe("2026-05-27T14:00:00+09:00");
  });

  test("clean keeps retention disabled by default and uses config when present", async () => {
    const home = await tempHome();
    let current = new Date("2026-01-01T00:00:00.000Z");
    const files = createFileStore({ root: home });
    const store = createMemoryStore(files, { now: () => current, timeZone: "Asia/Seoul" });
    const item = await store.add("old memory");

    current = new Date("2026-05-01T00:00:00.000Z");
    await expect(store.clean()).resolves.toMatchObject({ candidates: [], removed: [] });

    await files.write("config.json", { clean: { olderThan: "90d" } });
    await expect(store.clean({ dryRun: true })).resolves.toMatchObject({
      candidates: [item.meta.id],
      removed: [],
    });
    await expect(store.get(item.meta.id)).resolves.not.toBeNull();

    await expect(store.clean()).resolves.toMatchObject({
      candidates: [item.meta.id],
      removed: [item.meta.id],
    });
    await expect(store.get(item.meta.id)).resolves.toBeNull();
  });

  test("parses cleanup durations", () => {
    expect(parseDuration("90d")).toBe(90 * 24 * 60 * 60 * 1000);
    expect(parseDuration("12h")).toBe(12 * 60 * 60 * 1000);
    expect(() => parseDuration("soon")).toThrow("Invalid duration");
  });
});

async function tempHome(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "duru-memory-store-test-"));
}
