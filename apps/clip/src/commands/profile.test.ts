import { describe, expect, test } from "bun:test";
import type { CliTarget } from "@clip/core";
import { ClipError } from "@clip/core";
import { applyOverride, resolveProfile } from "./profile.ts";

const base: CliTarget = {
  command: "gh",
  args: ["--hostname", "github.com"],
  env: { BASE_VAR: "base" },
  allow: ["pr", "issue"],
};

describe("applyOverride", () => {
  test("args replace", () => {
    const result = applyOverride(base, { args: ["--hostname", "prod.example.com"] });
    expect(result.args).toEqual(["--hostname", "prod.example.com"]);
    expect(result.command).toBe("gh");
  });

  test("env merge — profile overrides base", () => {
    const result = applyOverride(base, { env: { PROFILE_VAR: "p", BASE_VAR: "overridden" } });
    expect(result.env).toEqual({ BASE_VAR: "overridden", PROFILE_VAR: "p" });
  });

  test("acl fields not affected by profile", () => {
    const result = applyOverride(base, { args: ["--hostname", "prod.example.com"] });
    expect(result.allow).toEqual(["pr", "issue"]);
  });

  test("undefined profile fields skipped", () => {
    const result = applyOverride(base, { command: undefined, args: ["--hostname", "other.example.com"] });
    expect(result.command).toBe("gh");
    expect(result.args).toEqual(["--hostname", "other.example.com"]);
  });
});

describe("resolveProfile", () => {
  const targetWithProfiles: CliTarget = {
    ...base,
    profiles: {
      "prod-kr": { args: ["--hostname", "prod.example.com"] },
      "alpha-kr": { args: ["--hostname", "alpha.example.com"] },
    },
    active: "prod-kr",
  };

  test("explicit profile overrides active", () => {
    const { merged, profileName } = resolveProfile(targetWithProfiles, "alpha-kr");
    expect(merged.args).toEqual(["--hostname", "alpha.example.com"]);
    expect(profileName).toBe("alpha-kr");
  });

  test("active profile used when no explicit", () => {
    const { merged, profileName } = resolveProfile(targetWithProfiles);
    expect(merged.args).toEqual(["--hostname", "prod.example.com"]);
    expect(profileName).toBe("prod-kr");
  });

  test("no profile — target returned as-is", () => {
    const { merged, profileName } = resolveProfile(base);
    expect(merged).toBe(base);
    expect(profileName).toBeUndefined();
  });

  test("non-existent profile exits process", () => {
    expect(() => resolveProfile(targetWithProfiles, "does-not-exist")).toThrow(ClipError);
  });
});
