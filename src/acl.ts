import type { AclTree } from "./config.ts";
import { die } from "./errors.ts";

type AclConfig = {
  allow?: string[];
  deny?: string[];
  acl?: AclTree;
};

function matchesPattern(pattern: string, value: string): boolean {
  if (!pattern.includes("*")) return pattern === value;
  const re = new RegExp(
    "^" + pattern.split("*").map(s => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$"
  );
  return re.test(value);
}

function matchesAny(patterns: string[], value: string): boolean {
  return patterns.some(p => matchesPattern(p, value));
}

export function checkAcl(
  target: AclConfig,
  subcommand: string,
  subSubcommand: string | undefined,
  targetName: string,
): void {
  const { allow, deny, acl } = target;

  // 트리 ACL: subcommand가 acl 트리에 있으면 sub-subcommand 레벨 체크
  if (acl && subcommand in acl) {
    const node = acl[subcommand]!;
    if (subSubcommand) {
      if (node.allow && node.allow.length > 0 && !matchesAny(node.allow, subSubcommand)) {
        die(
          `"${targetName} ${subcommand} ${subSubcommand}" is not allowed.\nAllowed: ${node.allow.join(", ")}`,
        );
      }
      if (node.deny && node.deny.length > 0 && matchesAny(node.deny, subSubcommand)) {
        die(`"${targetName} ${subcommand} ${subSubcommand}" is denied.`);
      }
    }
    return;
  }

  // 폴백: 기존 flat allow/deny로 subcommand 체크
  if (allow && allow.length > 0 && !matchesAny(allow, subcommand)) {
    die(
      `"${targetName} ${subcommand}" is not allowed.\nAllowed: ${allow.join(", ")}`,
    );
  }
  if (deny && deny.length > 0 && matchesAny(deny, subcommand)) {
    die(`"${targetName} ${subcommand}" is denied.`);
  }
}
