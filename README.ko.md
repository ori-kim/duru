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

### PATH 설정

`~/.local/bin`이 PATH에 없다면 셸 프로필에 추가하세요:

```sh
export PATH="$PATH:$HOME/.local/bin"
```

### 네이티브 바인드 (선택)

바인드를 사용하면 `clip` 접두사 없이 대상 명령어를 직접 실행할 수 있습니다:

```sh
clip bind gh   # 이제 'gh'가 clip을 통해 라우팅됨
gh pr list     # clip gh pr list 와 동일
```

clip이 명령어를 가로채려면 `~/.clip/bin`을 PATH **앞에** 추가하세요:

```sh
export PATH="$HOME/.clip/bin:$PATH"
```

## Zsh 자동완성

`~/.zshrc`에 추가하세요:

```sh
eval "$(clip completion zsh)"
```

이후 셸을 재시작하거나 `source ~/.zshrc`를 실행하세요.

- `clip <TAB>` — 타입별로 그룹화된 등록 대상 (cli / mcp / api) 및 URL·명령어 표시, built-in은 마지막
- `clip <target> <TAB>` — 도구·오퍼레이션 이름과 설명 (1시간 캐시)
- `clip gh pr <TAB>` — 원본 명령어의 자동완성에 위임

타이핑 중 inline 회색 힌트를 원한다면 [zsh-autosuggestions](https://github.com/zsh-users/zsh-autosuggestions) 설치 후:

```sh
ZSH_AUTOSUGGEST_STRATEGY=(history completion)
```

캐시를 수동으로 초기화하려면:

```sh
rm -f ~/.zcompcache/clip-tools-*
```

## Claude Code 통합

clip을 Claude Code 스킬로 설치하면 AI 에이전트가 등록된 대상을 직접 도구로 사용할 수 있습니다:

```sh
# skills.sh로 설치 (GitHub 레포 직접 지정, 별도 등록 불필요)
npx skills add https://github.com/ori-kim/cli-proxy

# 또는 clip 자체 커맨드로 설치
clip skills add claude-code
```

설치 후 Claude Code는 모든 clip 대상을 도구로 호출할 수 있으며, 호출마다 ACL 규칙이 적용됩니다.

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

트리 기반 규칙은 `~/.clip/target/cli/gh/config.yml`을 직접 편집하세요:

```yaml
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
| `~/.clip/target/{cli,mcp,api}/<name>/config.yml` | 대상 설정 및 ACL 규칙 |
| `~/.clip/target/{mcp,api}/<name>/auth.json` | OAuth 토큰 |
| `~/.clip/target/api/<name>/spec.json` | 캐시된 OpenAPI 스펙 |
| `~/.clip/.env` | 전역 환경변수 (`config.yml`에 치환) |

## 커맨드

| 커맨드 | 설명 |
|--------|------|
| `clip add <name> <cmd>` | CLI 대상 등록 |
| `clip add <name> <https://...mcp>` | HTTP MCP 대상 등록 |
| `clip add <name> --stdio <cmd> [args]` | STDIO MCP 대상 등록 |
| `clip add <name> <https://.../openapi.json>` | OpenAPI REST 대상 등록 |
| `clip remove <name>` | 대상 삭제 |
| `clip list` | 전체 대상 목록 및 인증 상태 |
| `clip login <target>` | OAuth 인증 |
| `clip logout <target>` | 저장된 토큰 삭제 |
| `clip refresh <target>` | OpenAPI 스펙 재fetch |
| `clip <target> tools` | 사용 가능한 도구·오퍼레이션 목록 |
| `clip bind <target>` | 네이티브 명령어 심 생성 |
| `clip unbind <target>` | 네이티브 명령어 심 삭제 |
| `clip binds` | 현재 바인드된 대상 목록 |
| `clip skills add claude-code` | Claude Code 스킬로 설치 |
| `clip completion zsh` | zsh 자동완성 스크립트 출력 |

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
