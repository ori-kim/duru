import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { isMacOS } from "./platform.ts";
import { addGenericPassword, deleteGenericPassword, findGenericPassword } from "./security-cli.ts";

const TEST_SERVICE = "duru.secrets.test";
const TEST_ACCOUNTS: string[] = [];

async function cleanup() {
  for (const a of TEST_ACCOUNTS.splice(0)) {
    try {
      await deleteGenericPassword(TEST_SERVICE, a);
    } catch {
      // ignore
    }
  }
}

beforeAll(cleanup);
afterAll(cleanup);
afterEach(cleanup);

const itMac = isMacOS() ? it : it.skip;

describe("security CLI wrapper (macOS only)", () => {
  itMac("add + find round-trips value", async () => {
    TEST_ACCOUNTS.push("round-trip-1");
    await addGenericPassword(TEST_SERVICE, "round-trip-1", "secret-value");
    expect(await findGenericPassword(TEST_SERVICE, "round-trip-1")).toBe("secret-value");
  });

  itMac("update existing entry", async () => {
    TEST_ACCOUNTS.push("update-1");
    await addGenericPassword(TEST_SERVICE, "update-1", "v1");
    await addGenericPassword(TEST_SERVICE, "update-1", "v2");
    expect(await findGenericPassword(TEST_SERVICE, "update-1")).toBe("v2");
  });

  itMac("find returns undefined for missing", async () => {
    expect(await findGenericPassword(TEST_SERVICE, "definitely-missing")).toBeUndefined();
  });

  itMac("delete removes entry", async () => {
    TEST_ACCOUNTS.push("delete-1");
    await addGenericPassword(TEST_SERVICE, "delete-1", "v");
    await deleteGenericPassword(TEST_SERVICE, "delete-1");
    expect(await findGenericPassword(TEST_SERVICE, "delete-1")).toBeUndefined();
  });

  itMac("delete missing entry is no-op", async () => {
    await deleteGenericPassword(TEST_SERVICE, "never-existed");
  });

  itMac("handles printable special chars", async () => {
    TEST_ACCOUNTS.push("special-1");
    // security -w auto-detects encoding and outputs hex for non-printable bytes.
    // For our use case (OAuth tokens, API keys) values are always printable ASCII.
    const value = `quote"and\\back/slash:colon=eq`;
    await addGenericPassword(TEST_SERVICE, "special-1", value);
    expect(await findGenericPassword(TEST_SERVICE, "special-1")).toBe(value);
  });
});
