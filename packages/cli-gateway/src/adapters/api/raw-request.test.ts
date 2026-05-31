import { expect, test } from "bun:test";

import { parseRequestArgs } from "./raw-request";

test("raw multipart field prefixed with @ reads a local file", async () => {
  const tmp = `/tmp/duru-raw-multipart-${process.pid}.txt`;
  await Bun.write(tmp, "raw-contents");
  const { body, contentType } = parseRequestArgs(["POST", "/upload", "--multipart", `file=@${tmp}`]);
  expect(body).toBeInstanceOf(FormData);
  expect(contentType).toBeUndefined();
  const entry = (body as FormData).get("file");
  expect(entry).toBeInstanceOf(Blob);
  expect(await (entry as Blob).text()).toBe("raw-contents");
});

test("raw multipart field without @ stays a string", () => {
  const { body } = parseRequestArgs(["POST", "/upload", "--multipart", "name=hello"]);
  expect(body).toBeInstanceOf(FormData);
  expect((body as FormData).get("name")).toBe("hello");
});
