import packageJson from "../package.json" with { type: "json" };

export const DURU_VERSION: string = packageJson.version;
