import { describe, expect, test } from "bun:test";
import { formatListRows } from "./list.ts";

const plainOpts = { color: (_code: string, text: string) => text };

describe("formatListRows", () => {
  test("aligns optional right-side columns within a section", () => {
    const lines = formatListRows(
      [
        { name: "catservice", subject: "https://catservice.example.com", status: "no auth" },
        {
          name: "notes-api",
          subject: "https://notes.example.com",
          detail: "(allow: v1/notes/*/query)",
          status: "api key",
        },
        { name: "search-api", subject: "https://search.example.com", profile: "@prod", status: "no auth" },
      ],
      plainOpts,
    );

    const statusColumns = lines.map((line) => line.indexOf("[")).filter((index) => index >= 0);
    expect(new Set(statusColumns).size).toBe(1);
    expect(lines[1]).toContain("(allow: v1/notes/*/query)");
    expect(lines[2]).toContain("@prod");
  });

  test("keeps marker column aligned after details", () => {
    const lines = formatListRows(
      [
        { name: "gh", subject: "gh", profile: "@team", detail: "(allow: pr,issue,api)", markers: ["bind"] },
        { name: "git", subject: "git" },
      ],
      plainOpts,
    );

    expect(lines[0]).toContain("[bind]");
    expect(lines[0].indexOf("[bind]")).toBeLessThan(lines[0].indexOf("(allow"));
    expect(lines[1]).not.toContain("[bind]");
  });
});
