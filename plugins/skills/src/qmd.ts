// skills 플러그인의 qmd 통합 레이어
// 실제 구현은 @duru/qmd 패키지에 위임한다.
export { createQmdClient } from "@duru/qmd";
export type { QmdClient, QmdSearchResult } from "@duru/qmd";

export const COLLECTION = "skills";

/** qmd 미설치 안내 메시지 */
export const QMD_INSTALL_MSG =
  "qmd를 찾을 수 없습니다. @duru/plugin-skills 를 재설치하거나\n  bun install 을 실행해주세요.";
