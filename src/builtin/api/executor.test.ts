import { describe, expect, test } from "bun:test";
import { buildCurlCommand } from "./executor.ts";

// --- buildCurlCommand ---

describe("buildCurlCommand / 기본", () => {
  test("GET 요청 — body 없음", () => {
    const r = buildCurlCommand("GET", "https://api.example.com/users", {}, undefined);
    expect(r).toContain("curl -X GET");
    expect(r).toContain("'https://api.example.com/users'");
    expect(r).not.toContain("-d");
    expect(r).not.toContain("--data");
  });

  test("메서드 소문자 → 대문자로 변환", () => {
    const r = buildCurlCommand("post", "https://api.example.com/", {}, undefined);
    expect(r).toContain("curl -X POST");
  });

  test("출력 끝이 개행 문자", () => {
    const r = buildCurlCommand("GET", "https://api.example.com/", {}, undefined);
    expect(r.endsWith("\n")).toBe(true);
  });

  test("헤더 한 개", () => {
    const r = buildCurlCommand("GET", "https://api.example.com/", { Authorization: "Bearer tok" }, undefined);
    expect(r).toContain("-H 'Authorization: Bearer tok'");
  });

  test("헤더 여러 개 — 모두 포함", () => {
    const r = buildCurlCommand(
      "POST",
      "https://api.example.com/",
      { "Content-Type": "application/json", "X-Custom": "val" },
      undefined,
    );
    expect(r).toContain("-H 'Content-Type: application/json'");
    expect(r).toContain("-H 'X-Custom: val'");
  });

  test("헤더 있으면 backslash 줄 이음 포함", () => {
    const r = buildCurlCommand("GET", "https://api.example.com/", { "X-H": "v" }, undefined);
    expect(r).toContain(" \\\n");
  });
});

describe("buildCurlCommand / JSON body", () => {
  test("JSON body → -d 플래그 사용", () => {
    const r = buildCurlCommand("POST", "https://api.example.com/", {}, '{"name":"test"}');
    expect(r).toContain("-d '{\"name\":\"test\"}'");
  });

  test("body 내 단따옴표는 쉘 안전하게 이스케이프", () => {
    // JSON body에 단따옴표가 있으면 '\\'' 패턴으로 이스케이프
    const r = buildCurlCommand("POST", "https://api.example.com/", {}, `{"name":"it's"}`);
    expect(r).not.toMatch(/'\{"name":"it's"\}'/); // 이스케이프 안 된 단따옴표 없어야 함
    expect(r).toContain("it'\\''s");
  });
});

describe("buildCurlCommand / URLSearchParams body (form-encoded)", () => {
  test("URLSearchParams → --data-raw 플래그 사용 (이미 인코딩된 데이터)", () => {
    const form = new URLSearchParams({ name: "John", age: "30" });
    const r = buildCurlCommand("POST", "https://api.example.com/form", {}, form);
    // --data-urlencode는 재인코딩 버그가 있으므로 --data-raw를 사용해야 함
    expect(r).not.toContain("--data-urlencode");
    expect(r).toContain("--data-raw");
  });

  test("URLSearchParams 값이 출력에 포함", () => {
    const form = new URLSearchParams({ q: "hello world" });
    const r = buildCurlCommand("POST", "https://api.example.com/search", {}, form);
    // URLSearchParams는 공백을 '+'로 인코딩
    expect(r).toContain("q=hello+world");
  });

  test("URLSearchParams 특수문자 — 이미 인코딩된 상태로 전달", () => {
    const form = new URLSearchParams({ token: "a+b&c=d" });
    const r = buildCurlCommand("POST", "https://api.example.com/", {}, form);
    // URLSearchParams가 & → %26, + → %2B 등으로 인코딩
    const encoded = form.toString();
    expect(r).toContain(encoded);
  });
});

describe("buildCurlCommand / 헤더 single-quote escape (회귀)", () => {
  test("헤더 값에 단따옴표 포함 시 쉘 안전하게 이스케이프", () => {
    const r = buildCurlCommand("GET", "https://api.example.com/", { Authorization: "Bearer it's-a-token" }, undefined);
    expect(r).not.toMatch(/-H 'Authorization: Bearer it's-a-token'/);
    expect(r).toContain("it'\\''s-a-token");
  });

  test("헤더 키에 단따옴표 포함 시 이스케이프", () => {
    const r = buildCurlCommand("GET", "https://api.example.com/", { "X-Na'me": "val" }, undefined);
    expect(r).toContain("X-Na'\\''me");
  });
});

// --- 회귀: --data-urlencode 이중 인코딩 버그 ---
// URLSearchParams.toString()은 이미 URL 인코딩된 문자열을 반환함.
// --data-urlencode는 값을 다시 인코딩하므로 '+' → '%2B' 등 이중 인코딩 발생.
// 올바른 플래그는 --data-raw 또는 --data (이미 인코딩된 데이터 그대로 전송).

describe("buildCurlCommand / 이중 인코딩 회귀 방지", () => {
  test("URLSearchParams 공백(+) 이중 인코딩 없음", () => {
    const form = new URLSearchParams({ name: "John Smith" });
    // URLSearchParams.toString() → "name=John+Smith"
    // --data-urlencode 'name=John+Smith' → curl이 '+' 를 '%2B'로 재인코딩 → 버그
    // --data-raw 'name=John+Smith' → 그대로 전송 → 올바름
    const r = buildCurlCommand("POST", "https://api.example.com/", {}, form);
    expect(r).not.toContain("--data-urlencode");
    // 올바른 플래그 사용 확인
    expect(r).toMatch(/--data[-\w]* 'name=John\+Smith'/);
  });
});
