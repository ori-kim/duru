export async function responseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (
    contentType.includes("json") ||
    contentType.startsWith("text/") ||
    contentType.includes("xml") ||
    contentType.includes("yaml")
  ) {
    const text = await response.text();
    if (!text) return "";
    if (contentType.includes("json")) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    return text;
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) return "";
  return {
    contentType: contentType || "application/octet-stream",
    encoding: "base64",
    data: Buffer.from(bytes).toString("base64"),
    size: bytes.length,
  };
}
