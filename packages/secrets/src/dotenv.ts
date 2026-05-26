export function parseDotenv(text: string): Map<string, string> {
  const env = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*export\s+/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    env.set(key, parseValue(line.slice(eq + 1).trim()));
  }
  return env;
}

function parseValue(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\(["\\nrt])/g, (_m, e: string) => {
      if (e === "n") return "\n";
      if (e === "r") return "\r";
      if (e === "t") return "\t";
      return e;
    });
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1);
  }
  const hashAt = raw.indexOf(" #");
  return (hashAt >= 0 ? raw.slice(0, hashAt) : raw).trim();
}
