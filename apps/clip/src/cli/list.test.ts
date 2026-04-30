import { describe, expect, test } from "bun:test";
import { formatListRows } from "./list.ts";

const plainOpts = { color: (_code: string, text: string) => text };

describe("formatListRows", () => {
  test("aligns optional right-side columns within a section", () => {
    const lines = formatListRows(
      [
        { name: "ehr", subject: "https://inhouse.kr.krmt.io", status: "no auth" },
        {
          name: "notion-api",
          subject: "https://api.notion.com",
          detail: "(allow: v1/databases/*/query)",
          status: "api key",
        },
        { name: "quickwit", subject: "https://quickwit.kr.krmt.io", profile: "@prod", status: "no auth" },
      ],
      plainOpts,
    );

    const statusColumns = lines.map((line) => line.indexOf("[")).filter((index) => index >= 0);
    expect(new Set(statusColumns).size).toBe(1);
    expect(lines[1]).toContain("(allow: v1/databases/*/query)");
    expect(lines[2]).toContain("@prod");
  });

  test("keeps marker column aligned after details", () => {
    const lines = formatListRows(
      [
        { name: "gh", subject: "gh", profile: "@karrot", detail: "(allow: pr,issue,api)", markers: ["bind"] },
        { name: "git", subject: "git" },
      ],
      plainOpts,
    );

    expect(lines[0]).toContain("[bind]");
    expect(lines[0].indexOf("[bind]")).toBeLessThan(lines[0].indexOf("(allow"));
    expect(lines[1]).not.toContain("[bind]");
  });
});
