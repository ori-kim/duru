// SKILL.md frontmatter
export type SkillMeta = {
  name: string;
  description: string;
  tags: string[];
  allowedTools?: string[];
};

// 파일 시스템상의 스킬 레코드
export type SkillRecord = {
  meta: SkillMeta;
  dir: string;       // DURU_HOME/skills/<name>
  skillPath: string; // DURU_HOME/skills/<name>/SKILL.md
};
