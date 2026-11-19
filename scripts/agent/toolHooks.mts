// Harness-valid Pre/PostToolUse adapters. Subprocess logs never share stdout with the JSON protocol.
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanGitEnvironment, git } from '../checks/git.mts'
import { formatFiles } from '../checks/format.mts'
import { repositoryRoot, runCommand } from '../checks/process.mts'
import { readInput } from './input.mts'
import { denyTool, explicitEditPaths, parseToolEvent, preToolProblem, successfulExplicitEdit } from './toolPolicy.mts'

export async function toolHook(raw: string, scriptRoot = repositoryRoot) {
  const event = parseToolEvent(raw)
  const env = cleanGitEnvironment(scriptRoot)
  const root = git(['rev-parse', '--show-toplevel'], event.cwd, { env }).trim()
  const common = (cwd: string) => realpathSync(git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd, { env }).trim())
  if (common(root) !== common(scriptRoot)) {
    throw new Error('Tool hook cwd belongs to another repository.')
  }
  if (event.hook_event_name === 'PreToolUse') {
    const problem = preToolProblem(event, root, process.env['CLAUSID_ALLOW_POLICY_EDITS'] === '1')
    return problem ? denyTool(problem) : {}
  }
  let output = ''
  const capture = (text: string) => {
    output = (output + text).slice(-8000)
  }
  try {
    if (successfulExplicitEdit(event)) {
      await formatFiles(
        true,
        root,
        explicitEditPaths(event).map((file) => {
          // Formatter accepts repository-relative or absolute paths; event paths are relative to event cwd.
          return resolve(event.cwd, file)
        }),
        capture,
      )
    }
    await runCommand({ id: 'post-tool-policy', command: 'pnpm', args: ['check:policy'] }, root, 60_000, { env, onOutput: capture })
    await runCommand({ id: 'post-tool-static', command: 'pnpm', args: ['check'] }, root, 120_000, { env, onOutput: capture })
    return {
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: 'Clausid post-tool policy and static checks passed. Full integration profiles remain required.',
      },
    }
  } catch (error) {
    const reason =
      `Clausid post-tool checks failed. Preserve unrelated changes and fix findings within task scope.\n${output}\n${error instanceof Error ? error.message : String(error)}`.slice(
        -10_000,
      )
    return { decision: 'block', reason }
  }
}

if (process.argv[1]?.endsWith('/toolHooks.mts') || process.argv[1]?.endsWith('scripts/agent/toolHooks.mts')) {
  try {
    process.stdout.write(JSON.stringify(await toolHook(readInput())) + '\n')
  } catch (error) {
    // A malformed PreToolUse must deny rather than use unsupported Codex continue/ask fields.
    process.stdout.write(
      JSON.stringify(denyTool(`Clausid tool hook failed: ${error instanceof Error ? error.message : String(error)}. Report the hook failure.`)) + '\n',
    )
    process.exitCode = 2
  }
}
