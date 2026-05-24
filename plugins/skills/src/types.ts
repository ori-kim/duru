export type SkillMeta = {
  name: string;
  description?: string;
  tags: string[];
  allowedTools?: string[];
};

export type SkillRecord = {
  meta: SkillMeta;
  dir: string;
  skillPath: string;
};
