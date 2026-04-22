import { describe, expect, test } from "bun:test";
import type { CliTarget } from "@clip/core";
import { ClipError } from "@clip/core";
import { applyOverride, resolveProfile } from "./profile.ts";

const base: CliTarget = {
  command: "gh",
  args: ["exec", "default", "--", "gh"],
  env: { BASE_VAR: "base" },
  allow: ["get", "describe"],
};

describe("applyOverride", () => {
  test("args replace", () => {
    const result = applyOverride(base, { args: ["exec", "prod", "--", "gh"] });
    expect(result.args).toEqual(["exec", "prod", "--", "gh"]);
    expect(result.command).toBe("gh");
  });

  test("env merge — profile overrides base", () => {
    const result = applyOverride(base, { env: { PROFILE_VAR: "p", BASE_VAR: "overridden" } });
    expect(result.env).toEqual({ BASE_VAR: "overridden", PROFILE_VAR: "p" });
  });

  test("acl fields not affected by profile", () => {
    const result = applyOverride(base, { args: ["exec", "prod", "--", "gh"] });
    expect(result.allow).toEqual(["get", "describe"]);
  });

  test("undefined profile fields skipped", () => {
    const result = applyOverride(base, { command: undefined, args: ["exec", "other", "--", "gh"] });
    expect(result.command).toBe("gh");
    expect(result.args).toEqual(["exec", "other", "--", "gh"]);
  });
});

describe("resolveProfile", () => {
  const targetWithProfiles: CliTarget = {
    ...base,
    profiles: {
      "prod-kr": { args: ["exec", "example/prod/kr", "--", "gh"] },
      "alpha-kr": { args: ["exec", "example/alpha/kr", "--", "gh"] },
    },
    active: "prod-kr",
  };

  test("explicit profile overrides active", () => {
    const { merged, profileName } = resolveProfile(targetWithProfiles, "alpha-kr");
    expect(merged.args).toEqual(["exec", "example/alpha/kr", "--", "gh"]);
    expect(profileName).toBe("alpha-kr");
  });

  test("active profile used when no explicit", () => {
    const { merged, profileName } = resolveProfile(targetWithProfiles);
    expect(merged.args).toEqual(["exec", "example/prod/kr", "--", "gh"]);
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
