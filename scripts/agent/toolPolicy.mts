// Pure, bounded guardrails for recognized tool calls; this is not a shell sandbox.
import { existsSync, realpathSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { z } from 'zod'
import { protectedPolicyFile } from '../checks/protected.mts'

const eventSchema = z.object({
  session_id: z.string().min(1).max(256),
  cwd: z.string().min(1).max(4096),
  hook_event_name: z.enum(['PreToolUse', 'PostToolUse']),
  tool_name: z.string().min(1).max(256),
  tool_input: z.unknown(),
  tool_response: z.unknown().optional(),
})
export type ToolEvent = z.infer<typeof eventSchema>
export function parseToolEvent(raw: string): ToolEvent {
  if (Buffer.byteLength(raw) > 128 * 1024) {
    throw new Error('Tool hook input exceeds its size limit.')
  }
  return eventSchema.parse(JSON.parse(raw))
}
function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object' ? Reflect.get(value, key) : undefined
}
export function toolCommand(event: ToolEvent): string | undefined {
  const command = field(event.tool_input, 'command') ?? field(event.tool_input, 'cmd')
  return typeof command === 'string' ? command : undefined
}
export function explicitEditPaths(event: ToolEvent): readonly string[] {
  if (['Write', 'Edit', 'MultiEdit'].includes(event.tool_name)) {
    const file = field(event.tool_input, 'file_path')
    return typeof file === 'string' ? [file] : []
  }
  if (event.tool_name === 'apply_patch') {
    const patch = toolCommand(event)
    if (!patch) {
      return []
    }
    return [...patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)]
      .map((match) => match[1])
      .filter((file): file is string => file !== undefined)
  }
  return []
}
export function localPolicyPath(path: string, cwd: string, root: string): string | undefined {
  const absolute = resolve(cwd, path)
  // Resolve existing parents too: a newly created file can live under a symlink.
  let ancestor = absolute
  while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) {
    ancestor = dirname(ancestor)
  }
  const resolved = resolve(realpathSync(ancestor), relative(ancestor, absolute))
  const local = relative(realpathSync(root), resolved).replaceAll('\\', '/')
  return local === '..' || local.startsWith('../') ? undefined : local
}
export function commandProblem(command: string): string | undefined {
  const segments = command.split(/;|&&|\|\||\n/).filter((segment) => segment.trim())
  if (segments.length > 1) {
    for (const segment of segments) {
      const problem = commandProblem(segment)
      if (problem) {
        return problem
      }
    }
  }
  const flat = command.replace(/\\\r?\n/g, '').replace(/["']/g, '')
  if (/\bCLAUSID_ALLOW_POLICY_EDITS\s*=/.test(flat) || /\b(?:export|setenv|unset)\s+CLAUSID_ALLOW_POLICY_EDITS\b/.test(flat)) {
    return 'Only the operator may provide policy-edit authorization when launching the client; an agent cannot set or replace it.'
  }
  if (/\bgit\b[\s\S]*?(?:--no-verify\b|\bcommit\b[^\n;|&]*\s-(?!-)[a-z]*n[a-z]*\b)/.test(flat)) {
    return 'Git verification bypass options are prohibited; fix the shared checks.'
  }
  if (/\bcore\.hooks[Pp]ath(?:\s*=|\s|$)/.test(flat) && /\bgit\b/.test(flat) && !/(?:^|\s)--(?:get|show-origin|show-scope)\b/.test(flat)) {
    return 'Changing the active Git hooks path from an agent command is prohibited.'
  }
  if (/\bGIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)\s*=/.test(flat) || /\bgit\b[^\n]*(?:--config-env[=\s]|-c\s*core\.hooks[Pp]ath)/.test(flat)) {
    return 'Git configuration injection cannot bypass repository hooks.'
  }
  if (
    /\b(?:HUSKY|SKIP_HOOKS|SKIP_CHECKS|LEFTHOOK|PRE_COMMIT_ALLOW_NO_CONFIG)\s*=\s*(?:0|1|true)\b/.test(flat) ||
    /\bSKIP\s*=\s*(?:pre-commit|pre-push|commit-msg)/.test(flat)
  ) {
    return 'Recognized hook/check bypass environment overrides are prohibited.'
  }
  return undefined
}
export function preToolProblem(event: ToolEvent, root: string, authorized: boolean): string | undefined {
  const command = event.tool_name === 'Bash' || event.tool_name === 'exec_command' ? toolCommand(event) : undefined
  if (command) {
    const problem = commandProblem(command)
    if (problem) {
      return problem
    }
    // Known shell writes name their targets. Opaque scripts receive post-tool/static verification.
    if (!authorized && /(?:\b(?:rm|mv|cp|tee|touch)\b|\bsed\b[^\n]*\s-i|>|writeFile|write_text|open\()/i.test(command)) {
      const tokens = command.match(/"[^"]*"|'[^']*'|[^\s;|&()<>]+/g) ?? []
      for (const token of tokens) {
        const path = token.replace(/^["']|["']$/g, '')
        const local = localPolicyPath(path, event.cwd, root)
        if (local && protectedPolicyFile(local)) {
          return `Protected policy edit: ${local}. The operator must authorize policy work when launching the client.`
        }
      }
    }
  }
  if (!authorized) {
    for (const file of explicitEditPaths(event)) {
      const local = localPolicyPath(file, event.cwd, root)
      if (local && protectedPolicyFile(local)) {
        return `Protected policy edit: ${local}. The operator must authorize policy work when launching the client.`
      }
    }
  }
  return undefined
}
export function successfulExplicitEdit(event: ToolEvent): boolean {
  if (!explicitEditPaths(event).length) {
    return false
  }
  const response = event.tool_response
  if (typeof response === 'string') {
    return /^Success\. Updated the following files:/m.test(response)
  }
  if (field(response, 'isError') === true || field(response, 'success') === false || field(response, 'error') !== undefined) {
    return false
  }
  return (
    field(response, 'success') === true ||
    field(response, 'exit_code') === 0 ||
    field(response, 'isError') === false ||
    (typeof field(response, 'type') === 'string' && ['create', 'update', 'edit', 'replace'].some((type) => type === field(response, 'type')))
  )
}
export function denyTool(reason: string) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason.slice(0, 8000) } }
}
