import type { CompiledPattern, Params } from "../types/index.ts";

type PatternToken =
  | { kind: "literal"; value: string }
  | { kind: "param"; name: string; required: boolean }
  | { kind: "rest"; name: string; required: boolean };

export function compilePattern(pattern: string): CompiledPattern {
  const tokens = pattern.trim().split(/\s+/).filter(Boolean).map(parseToken);
  const paramNames = tokens.flatMap((token) => (token.kind === "literal" ? [] : [token.name]));

  return {
    pattern,
    paramNames,
    match(argv) {
      const params: Params = {};
      let index = 0;

      for (const token of tokens) {
        if (token.kind === "literal") {
          if (argv[index] !== token.value) return undefined;
          index += 1;
          continue;
        }
        if (token.kind === "rest") {
          const rest = argv.slice(index);
          if (token.required && rest.length === 0) return undefined;
          params[token.name] = rest;
          index = argv.length;
          break;
        }

        const value = argv[index];
        if (value === undefined) {
          if (token.required) return undefined;
        } else {
          params[token.name] = value;
          index += 1;
        }
      }

      return index === argv.length ? { params, positionals: argv } : undefined;
    },
  };
}

function parseToken(token: string): PatternToken {
  if (token.startsWith("<") && token.endsWith(">")) return parseParam(token.slice(1, -1), true);
  if (token.startsWith("[") && token.endsWith("]")) return parseParam(token.slice(1, -1), false);
  return { kind: "literal", value: token };
}

function parseParam(value: string, required: boolean): PatternToken {
  if (value.startsWith("...")) return { kind: "rest", name: value.slice(3), required };
  return { kind: "param", name: value, required };
}
