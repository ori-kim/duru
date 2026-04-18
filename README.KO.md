# clip

MCP 서버와 CLI 도구를 위한 통합 CLI 프록시 게이트웨이 — ACL 규칙 적용, OAuth 인증, AI 에이전트 통합을 하나의 커맨드로.

## 주요 기능

- **통합 프록시** — 모든 CLI 도구와 MCP 서버를 단일 게이트웨이로 관리
- **ACL 적용** — 트리 기반 규칙으로 대상별 서브커맨드 허용/차단
- **OAuth 2.1 PKCE** — MCP 서버 인증을 위한 안전한 토큰 관리
- **에이전트 통합** — Claude Code 스킬로 설치하여 AI 에이전트 워크플로우에서 활용
- **JSON/pipe 출력** — 스크립트와 에이전트 파이프라인을 위한 머신 친화적 모드

## 설치

```sh
curl -fsSL https://raw.githubusercontent.com/ori-kim/cli-proxy/main/install.sh | sh
```

기본 설치 경로는 `~/.local/bin/clip`. `CLIP_INSTALL_DIR` 환경변수로 변경 가능.

**수동 설치:** [최신 릴리즈](https://github.com/ori-kim/cli-proxy/releases/latest) · macOS 전용 (darwin-arm64, darwin-x64)

## 빠른 시작

```sh
# CLI 도구 등록
clip add gh gh --deny delete
clip gh pr list

# MCP 서버 등록 및 인증
clip add notion https://mcp.notion.com/mcp
clip login notion
clip notion search --query "..."

# 대상 관리
clip list
clip remove notion
```

## ACL 규칙

인라인 플래그로 최상위 규칙을 지정합니다:

```sh
clip add gh gh --deny delete
```

트리 기반 규칙은 `~/.clip/settings.yml`을 직접 편집하세요:

```yaml
cli:
  gh:
    command: gh
    acl:
      repo:
        allow: [list, view]
      pr:
        deny: [delete]
```

`deny`가 `allow`보다 우선합니다. 규칙은 인수 트리를 따라 왼쪽에서 오른쪽으로 평가됩니다.

## 설정

| 경로 | 용도 |
|------|------|
| `~/.clip/settings.yml` | 대상 및 ACL 규칙 |
| `~/.clip/mcp/<target>/auth.json` | OAuth 토큰 |

## 커맨드

| 커맨드 | 설명 |
|--------|------|
| `clip add <name> <cmd-or-url>` | 대상 등록 |
| `clip remove <name>` | 대상 삭제 |
| `clip list` | 전체 대상 목록 |
| `clip login <target>` | OAuth 인증 |
| `clip logout <target>` | 저장된 토큰 삭제 |
| `clip <target> tools` | MCP 도구 목록 |
| `clip skills add claude-code` | Claude Code 스킬로 설치 |

**글로벌 플래그:** `--json`, `--pipe`, `--help`, `--version`

## 개발

[Bun](https://bun.sh) ≥ 1.1 필요.

```sh
bun install
bun run src/clip.ts --help
bun run build   # → dist/
bun test
```

## 라이선스

MIT
