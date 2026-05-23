import { zshSingleQuote } from "./escape";
import type { RenderZshCompletionOptions, ZshCompletionStyle } from "./types";

export function renderZshCompletion(options: RenderZshCompletionOptions = {}): string {
  const commandName = options.commandName ?? "duru";
  const queryCommand = commandWords(options.queryCommand ?? ["completion", "query"]);
  const stylePrefix = `:completion:*:*:${commandName}:*`;

  return `#compdef ${commandName}

${renderZshCompletionStyles(stylePrefix, options.styles ?? [])}

_duru_completion() {
  emulate -L zsh
  setopt localoptions noshwordsplit

  local command_name=${zshSingleQuote(commandName)}
  local executable="\${words[1]:-$command_name}"
  local response
  response="$("$executable" ${queryCommand} --shell zsh --cursor "$CURRENT" -- "\${words[@]}" 2>/dev/null)" || return 0

  (( $+commands[jq] )) || return 0

  local -a groups
  groups=("\${(@f)$(print -r -- "$response" | jq -r '.items[]? | .group // "values"' 2>/dev/null | sort -u)}")
  (( \${#groups[@]} > 0 )) || return 0

  local group
  local ret=1
  for group in "\${groups[@]}"; do
    local -a matches
    matches=("\${(@f)$(print -r -- "$response" | jq -r --arg group "$group" '.items[]? | select((.group // "values") == $group) | (.value | gsub("\\\\\\\\"; "\\\\\\\\\\\\\\\\") | gsub(":"; "\\\\\\\\:")) + ":" + (.description // "" | gsub("\\n"; " "))' 2>/dev/null)}")
    (( \${#matches[@]} > 0 )) || continue
    _describe -t "$group" "$group" matches && ret=0
  done

  return ret
}

compdef _duru_completion ${commandName}
`;
}

export function renderZshCompletionStyles(prefix: string, styles: readonly ZshCompletionStyle[] = []): string {
  const lines = [`zstyle ${zshSingleQuote(prefix)} group-name ''`, `zstyle ${zshSingleQuote(prefix)} verbose yes`];

  for (const style of styles) {
    const context = `${prefix}:${style.tag}`;
    if (style.format) lines.push(`zstyle ${zshSingleQuote(context)} format ${zshSingleQuote(style.format)}`);
    if (style.color) lines.push(`zstyle ${zshSingleQuote(context)} list-colors ${zshSingleQuote(style.color)}`);
  }

  return lines.join("\n");
}

function commandWords(words: readonly string[]): string {
  return words.map(commandWord).join(" ");
}

function commandWord(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : zshSingleQuote(value);
}
