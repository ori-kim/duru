import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { waitForLocalOAuthCallback } from "./oauth-callback";

describe("local OAuth callback page", () => {
  test("renders a branded success page and serves the icon asset", async () => {
    const home = await mkdtemp(join(tmpdir(), "clip-oauth-callback-"));
    const iconPath = await writeTestIcon(home);
    const redirectUri = `http://127.0.0.1:${await freePort()}/oauth/callback`;
    const callback = waitForLocalOAuthCallback({ redirectUri, state: "state-value", iconPath });

    const icon = await fetch(new URL("/icon.png", redirectUri));
    const response = await fetch(`${redirectUri}?code=code-value&state=state-value`);
    const html = await response.text();

    await expect(callback).resolves.toEqual({ code: "code-value", state: "state-value" });
    expect(icon.status).toBe(200);
    expect(icon.headers.get("content-type")).toBe("image/png");
    expect(html).toContain("Authentication complete");
    expect(html).toContain('<img class="app-icon" src="/icon.png"');
    expect(html).toContain("min-height: 100dvh");
    expect(html).toContain("width: 96px;");
    expect(html).toContain("font-size: 52px;");
  });

  test("renders a branded failure page for provider errors", async () => {
    const home = await mkdtemp(join(tmpdir(), "clip-oauth-callback-error-"));
    const iconPath = await writeTestIcon(home);
    const redirectUri = `http://127.0.0.1:${await freePort()}/oauth/callback`;
    const callback = waitForLocalOAuthCallback({ redirectUri, state: "state-value", iconPath }).catch((error) => error);

    const response = await fetch(`${redirectUri}?error=access_denied&error_description=Denied`);
    const html = await response.text();

    await expect(callback).resolves.toThrow("OAuth callback returned error: access_denied");
    expect(response.status).toBe(400);
    expect(html).toContain("Authentication failed");
    expect(html).toContain("Denied");
  });
});

async function writeTestIcon(root: string): Promise<string> {
  const dir = join(root, "assets");
  await mkdir(dir, { recursive: true });
  const iconPath = join(dir, "icon.png");
  await writeFile(iconPath, Buffer.from("89504e470d0a1a0a", "hex"));
  return iconPath;
}

async function freePort(): Promise<number> {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("Unable to allocate test port"));
      });
    });
  });
}
