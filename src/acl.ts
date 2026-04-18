import type { AclTree } from "./config.ts";
import { die } from "./errors.ts";

type AclConfig = {
  allow?: string[];
  deny?: string[];
  acl?: AclTree;
};

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
      if (node.allow && node.allow.length > 0 && !node.allow.includes(subSubcommand)) {
        die(
          `"${targetName} ${subcommand} ${subSubcommand}" is not allowed.\nAllowed: ${node.allow.join(", ")}`,
        );
      }
      if (node.deny && node.deny.length > 0 && node.deny.includes(subSubcommand)) {
        die(`"${targetName} ${subcommand} ${subSubcommand}" is denied.`);
      }
    }
    return;
  }

  // 폴백: 기존 flat allow/deny로 subcommand 체크
  if (allow && allow.length > 0 && !allow.includes(subcommand)) {
    die(
      `"${targetName} ${subcommand}" is not allowed.\nAllowed: ${allow.join(", ")}`,
    );
  }
  if (deny && deny.length > 0 && deny.includes(subcommand)) {
    die(`"${targetName} ${subcommand}" is denied.`);
  }
}
