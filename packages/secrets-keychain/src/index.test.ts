import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderUnavailable } from "@duru/secrets";
import { KeychainProvider } from "./index.ts";
import { isMacOS } from "./platform.ts";
import { deleteGenericPassword, findGenericPassword } from "./security-cli.ts";

const TEST_SERVICE = "duru.secrets.test";
const accounts: string[] = [];
const tmpDirs: string[] = [];

afterEach(async () => {
  for (const a of accounts.splice(0)) {
    try {
      await deleteGenericPassword(TEST_SERVICE, a);
    } catch {
      // ignore
    }
  }
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeProvider(): KeychainProvider {
  const dir = mkdtempSync(join(tmpdir(), "kp-test-"));
  tmpDirs.push(dir);
  return new KeychainProvider({
    service: TEST_SERVICE,
    indexPath: join(dir, "index.json"),
  });
}

const itMac = isMacOS() ? it : it.skip;

describe("KeychainProvider", () => {
  it("scheme is 'keychain'", () => {
    if (!isMacOS()) {
      expect(() => new KeychainProvider()).toThrow(ProviderUnavailable);
      return;
    }
    expect(makeProvider().scheme).toBe("keychain");
  });

  itMac("set+get roundtrip", async () => {
    const p = makeProvider();
    accounts.push("rt-1");
    await p.set("rt-1", "v1");
    expect(await p.get("rt-1")).toBe("v1");
  });

  itMac("get missing returns undefined", async () => {
    expect(await makeProvider().get("nope")).toBeUndefined();
  });

  itMac("set updates index", async () => {
    const p = makeProvider();
    accounts.push("idx-1");
    await p.set("idx-1", "v");
    expect(await p.list()).toEqual(["idx-1"]);
  });

  itMac("delete removes from keychain + index", async () => {
    const p = makeProvider();
    accounts.push("del-1");
    await p.set("del-1", "v");
    await p.delete("del-1");
    expect(await findGenericPassword(TEST_SERVICE, "del-1")).toBeUndefined();
    expect(await p.list()).toEqual([]);
  });

  itMac("list with prefix", async () => {
    const p = makeProvider();
    accounts.push("gh/a", "gh/b", "aws/c");
    await p.set("gh/a", "1");
    await p.set("gh/b", "2");
    await p.set("aws/c", "3");
    expect((await p.list("gh/")).sort()).toEqual(["gh/a", "gh/b"]);
  });
});

describe("KeychainProvider OS guard", () => {
  it("throws ProviderUnavailable on non-darwin platforms", () => {
    if (isMacOS()) return;
    expect(() => new KeychainProvider()).toThrow(ProviderUnavailable);
  });
});
