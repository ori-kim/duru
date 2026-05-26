import { spawn } from "node:child_process";
import { release } from "node:os";
import type { SetInstructions } from "@duru/secrets";

export async function openPasswordsApp(account: string, service: string): Promise<SetInstructions> {
  const sonomaOrLater = Number.parseFloat(release()) >= 23;
  const app = sonomaOrLater ? "Passwords" : "Keychain Access";

  await new Promise<void>((resolve) => {
    const p = spawn("open", ["-a", app], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    p.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    p.on("error", (err) => {
      process.stderr.write(`warning: could not launch ${app}: ${err.message}\n`);
      resolve();
    });
    p.on("close", (code) => {
      if (code !== 0) {
        process.stderr.write(`warning: ${app} launch exited ${code}: ${stderr.trim()}\n`);
      }
      resolve();
    });
  });

  return {
    opened: `Apple ${app} app`,
    steps: [
      'Click "+" to add a new password',
      `Service / Title: ${service}`,
      `Account / Username: ${account}`,
      "Password: <paste your secret value>",
      "Save",
    ],
    verify: { method: "poll", intervalMs: 1000, timeoutMs: 120_000 },
  };
}
