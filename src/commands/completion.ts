import { die } from "../utils/errors.ts";

function buildZshCompletionCore(): string {
  return `\
zmodload zsh/complist 2>/dev/null

zstyle ':completion:*' use-cache yes
zstyle ':completion::complete:clip:' cache-policy _clip_cache_policy

# Separate tags into individual groups, show descriptions (list format)
zstyle ':completion:*:*:clip:*' group-name ''
zstyle ':completion:*:*:clip:*' verbose yes

# Group header format (colored)
zstyle ':completion:*:*:clip:*:cli-targets'     format '%F{green}── %d ──%f'
zstyle ':completion:*:*:clip:*:mcp-targets'     format '%F{yellow}── %d ──%f'
zstyle ':completion:*:*:clip:*:api-targets'     format '%F{cyan}── %d ──%f'
zstyle ':completion:*:*:clip:*:grpc-targets'    format '%B%F{blue}── %d ──%f%b'
zstyle ':completion:*:*:clip:*:graphql-targets' format '%F{205}── %d ──%f'
zstyle ':completion:*:*:clip:*:script-targets'  format '%F{245}── %d ──%f'
zstyle ':completion:*:*:clip:*:builtins'        format '── %d ──'
zstyle ':completion:*:*:clip:*:tools'           format '%F{246}── %d ──%f'

# Item colors per group
zstyle ':completion:*:*:clip:*:cli-targets'     list-colors '=*=32'
zstyle ':completion:*:*:clip:*:mcp-targets'     list-colors '=*=33'
zstyle ':completion:*:*:clip:*:api-targets'     list-colors '=*=36'
zstyle ':completion:*:*:clip:*:grpc-targets'    list-colors '=*=34;1'
zstyle ':completion:*:*:clip:*:graphql-targets' list-colors '=*=38;5;205'
zstyle ':completion:*:*:clip:*:script-targets'  list-colors '=*=38;5;245'

_clip_cache_policy() {
  local -a outdated
  outdated=( "$1"(Nmh+1) )
  (( $#outdated ))
}

_clip() {
  local gtdir="$HOME/.clip/target"
  local wstdir=""
  local wsfile="$HOME/.clip/.workspace"
  if [[ -f "$wsfile" && -s "$wsfile" ]]; then
    wstdir="$HOME/.clip/workspace/$(cat "$wsfile")/target"
  fi

  if (( CURRENT == 2 )); then
    local -a builtins=(
      'list:list all registered targets'
      'add:register a new CLI / MCP / API target'
      'remove:unregister a target'
      'refresh:re-fetch OpenAPI spec for an API target'
      'login:OAuth login for an MCP / API target'
      'logout:remove stored OAuth tokens'
      'workspace:manage workspaces'
      'bind:create a native command shim for a target'
      'unbind:remove a native command shim'
      'binds:list currently bound targets'
      'skills:install AI agent integration (claude-code, gemini, ...)'
      'completion:generate shell completion script'
    )
    local -a cli_targets=() mcp_targets=() api_targets=() grpc_targets=() graphql_targets=() script_targets=()
    typeset -A _seen_cli _seen_mcp _seen_api _seen_grpc _seen_graphql _seen_script
    local t name detail _base
    for _base in "$wstdir" "$gtdir"; do
      [[ -z "$_base" ]] && continue
      for t in "$_base/cli/"*(N/); do
        name="\${t:t}"
        [[ -n "\${_seen_cli[$name]}" ]] && continue
        _seen_cli[$name]=1
        detail=$(awk '/^command:/{print $2; exit}' "$t/config.yml" 2>/dev/null)
        cli_targets+=("$name:$detail")
      done
      for t in "$_base/mcp/"*(N/); do
        name="\${t:t}"
        [[ -n "\${_seen_mcp[$name]}" ]] && continue
        _seen_mcp[$name]=1
        detail=$(awk '/^transport:/{t=$2} /^url:/{print (t=="sse"?"sse: ":"")$2; exit} /^command:/{print "stdio: "$2; exit}' "$t/config.yml" 2>/dev/null)
        mcp_targets+=("$name:$detail")
      done
      for t in "$_base/api/"*(N/); do
        name="\${t:t}"
        [[ -n "\${_seen_api[$name]}" ]] && continue
        _seen_api[$name]=1
        detail=$(awk '/^baseUrl:/{b=$2} /^openapiUrl:/{u=$2} END{print (b?b:u)}' "$t/config.yml" 2>/dev/null)
        api_targets+=("$name:$detail")
      done
      for t in "$_base/grpc/"*(N/); do
        name="\${t:t}"
        [[ -n "\${_seen_grpc[$name]}" ]] && continue
        _seen_grpc[$name]=1
        detail=$(awk '/^address:/{print $2; exit}' "$t/config.yml" 2>/dev/null)
        grpc_targets+=("$name:$detail")
      done
      for t in "$_base/graphql/"*(N/); do
        name="\${t:t}"
        [[ -n "\${_seen_graphql[$name]}" ]] && continue
        _seen_graphql[$name]=1
        detail=$(awk '/^endpoint:/{print $2; exit}' "$t/config.yml" 2>/dev/null)
        graphql_targets+=("$name:$detail")
      done
      for t in "$_base/script/"*(N/); do
        name="\${t:t}"
        [[ -n "\${_seen_script[$name]}" ]] && continue
        _seen_script[$name]=1
        detail=$(awk '/^description:/{sub(/^description: */, ""); print; exit}' "$t/config.yml" 2>/dev/null)
        script_targets+=("$name:$detail")
      done
    done
    # targets first, built-ins last
    (( \${#cli_targets} ))     && _describe -t cli-targets     'cli'     cli_targets
    (( \${#mcp_targets} ))     && _describe -t mcp-targets     'mcp'     mcp_targets
    (( \${#api_targets} ))     && _describe -t api-targets     'api'     api_targets
    (( \${#grpc_targets} ))    && _describe -t grpc-targets    'grpc'    grpc_targets
    (( \${#graphql_targets} )) && _describe -t graphql-targets 'graphql' graphql_targets
    (( \${#script_targets} ))  && _describe -t script-targets  'script'  script_targets
    _describe -t builtins 'built-in' builtins
    return
  fi

  local target="\${words[2]}"

  # cli: delegate to the original command's completion
  local tdir="$gtdir"
  if [[ -n "$wstdir" && -f "$wstdir/cli/$target/config.yml" ]]; then
    tdir="$wstdir"
  fi
  if [[ -f "$tdir/cli/$target/config.yml" ]]; then
    local orig_cmd
    orig_cmd=$(awk '/^command:/{print $2; exit}' "$tdir/cli/$target/config.yml")
    [[ -z "$orig_cmd" ]] && return
    words=("$orig_cmd" "\${words[@]:2}")
    (( CURRENT-- ))
    _normal
    return
  fi

  # api / mcp: complete tool names at position 3 (cached, with spinner)
  if (( CURRENT == 3 )); then
    local -a tools
    local ws_name=""
    [[ -n "$wstdir" ]] && ws_name=$(cat "$wsfile" 2>/dev/null)
    local cache_id="clip-tools-v2-$target-$ws_name"
    if _cache_invalid "$cache_id" || ! _retrieve_cache "$cache_id"; then
      local tmpf
      tmpf=$(mktemp /tmp/clip-tools-XXXXXX)
      clip "$target" tools >"$tmpf" 2>/dev/null &
      local fetch_pid=$!
      if [[ -n "\$ZLE_STATE" ]]; then
        local -a _sp=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏)
        local _si=0
        while kill -0 $fetch_pid 2>/dev/null; do
          zle -R "  \${_sp[$((_si % 10 + 1))]} $target"
          sleep 0.1
          (( ++_si ))
        done
      fi
      wait $fetch_pid
      tools=("\${(@f)$(awk '/^  /{name=$1; sub(/^  [^ ]+[ ]+/, ""); print name":"$0}' "$tmpf")}")
      rm -f "$tmpf"
      _store_cache "$cache_id" tools
    fi
    _describe -t tools "tools ($target)" tools
    return
  fi
}
`;
}

// For eval "$(clip completion zsh)" in .zshrc
export function buildZshCompletion(): string {
  return `# clip zsh completion
# Add to ~/.zshrc:  eval "$(clip completion zsh)"
# Inline hints:     ZSH_AUTOSUGGEST_STRATEGY=(history completion)

${buildZshCompletionCore()}
compdef _clip clip
`;
}

export async function runCompletionCmd(args: string[]): Promise<void> {
  const [shell] = args;

  if (!shell || shell === "zsh") {
    process.stdout.write(buildZshCompletion());
    return;
  }

  die(`Unsupported shell: "${shell}"\nUsage: clip completion zsh`);
}
