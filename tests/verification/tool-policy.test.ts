// Exercise supported harness payloads, recognized bypasses, protected paths and post-edit scope in quoted worktrees.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vite-plus/test'
import { z } from 'zod'
import { commandProblem, denyTool, explicitEditPaths, parseToolEvent, preToolProblem, successfulExplicitEdit } from '../../scripts/agent/toolPolicy.mts'
import type { ToolEvent } from '../../scripts/agent/toolPolicy.mts'
import { repositoryRoot } from '../../scripts/checks/process.mts'
import { toolHook } from '../../scripts/agent/toolHooks.mts'

const scratch: string[] = []
function temporary() {
  const root = mkdtempSync(join(tmpdir(), "clausid tool's "))
  scratch.push(root)
  return root
}
afterEach(() => {
  for (const root of scratch.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})
const event = (root: string, name: string, input: unknown): ToolEvent => ({
  session_id: 'fixture',
  cwd: root,
  hook_event_name: 'PreToolUse',
  tool_name: name,
  tool_input: input,
})

it('rejects recognized Git/check bypass spellings without blocking ordinary Git inspection', () => {
  for (const command of [
    'git commit --no-verify -m x',
    'git commit -n -m x',
    'git commit -an -m x',
    '/usr/bin/git push --no-verify',
    "git -c 'core.hooksPath=/dev/null' commit -m x",
    'git -ccore.hooksPath=/dev/null push',
    'git --config-env=core.hooksPath=OTHER push',
    'git config --local core.hooksPath /tmp/empty',
    'git config --get core.hooksPath; git config core.hooksPath /tmp/empty',
    'GIT_CONFIG_COUNT=1 git push',
    'SKIP=pre-push git push',
    'HUSKY=0 git commit -m x',
    'CLAUSID_ALLOW_POLICY_EDITS=1 pnpm check',
    'export CLAUSID_ALLOW_POLICY_EDITS=1',
    'unset CLAUSID_ALLOW_POLICY_EDITS',
    'git com"mit" --no-verify -m x',
    'git commit \\\n+--no-verify -m x',
  ]) {
    expect(commandProblem(command), command).toBeTypeOf('string')
  }
  for (const command of ['git status --porcelain', 'git log -n 3', 'git push --dry-run', 'git config --get core.hooksPath', 'pnpm verify:all']) {
    expect(commandProblem(command), command).toBeUndefined()
  }
})

it('normalizes explicit edits and known shell write targets, including symlinked and newly created paths', () => {
  const root = temporary()
  mkdirSync(join(root, 'apps/web'), { recursive: true })
  mkdirSync(join(root, 'docs'))
  symlinkSync(join(root, 'docs'), join(root, 'alias'))
  const nested = join(root, 'apps/web')
  for (const call of [
    event(nested, 'Edit', { file_path: '../../AGENTS.md' }),
    event(nested, 'Write', { file_path: '../../alias/coding-standards.md' }),
    event(nested, 'apply_patch', { command: '*** Begin Patch\n*** Update File: ../../docs/enforcement.md\n@@\n+x\n*** End Patch' }),
    event(nested, 'Bash', { command: 'printf x > "../../docs/dependencies.md"' }),
  ]) {
    expect(preToolProblem(call, root, false)).toContain('Protected policy edit')
    expect(preToolProblem(call, root, true)).toBeUndefined()
  }
  expect(preToolProblem(event(root, 'Bash', { command: 'node scripts/checks/run.mts all' }), root, false)).toBeUndefined()
  expect(preToolProblem(event(root, 'Write', { file_path: 'apps/web/src/feature.ts' }), root, false)).toBeUndefined()
  expect(preToolProblem(event(root, 'Bash', { command: 'CLAUSID_ALLOW_POLICY_EDITS=1 git status' }), root, true)).toContain('Only the operator')
})

it('formats only proven successful explicit edits, never opaque shell output or failed writes', () => {
  const call = event('/repo', 'apply_patch', { command: '*** Begin Patch\n*** Update File: src/a.ts\n*** Move to: src/b.ts\n*** End Patch' })
  expect(explicitEditPaths(call)).toEqual(['src/a.ts', 'src/b.ts'])
  expect(successfulExplicitEdit({ ...call, tool_response: 'Success. Updated the following files:\nM src/a.ts' })).toBe(true)
  expect(successfulExplicitEdit({ ...call, tool_response: { success: false } })).toBe(false)
  expect(successfulExplicitEdit({ ...call, tool_response: 'opaque' })).toBe(false)
  expect(successfulExplicitEdit({ ...event('/repo', 'Bash', { command: 'echo edited' }), tool_response: { exit_code: 0 } })).toBe(false)
  expect(successfulExplicitEdit({ ...event('/repo', 'Write', { file_path: 'src/a.ts' }), tool_response: { type: 'create' } })).toBe(true)
})

it('bounds and validates payloads and emits the supported denial shape', () => {
  expect(() => parseToolEvent('{}')).toThrow()
  expect(() => parseToolEvent('x'.repeat(128 * 1024 + 1))).toThrow('size limit')
  expect(() => parseToolEvent('{broken')).toThrow()
  const output = denyTool('x'.repeat(12_000))
  expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
  expect(output.hookSpecificOutput.permissionDecisionReason).toHaveLength(8000)
  expect(output).not.toHaveProperty('continue')
  expect(output).not.toHaveProperty('stopReason')
  try {
    execFileSync(process.execPath, [join(repositoryRoot, 'scripts/agent/toolHooks.mts')], { input: '{}', encoding: 'utf8', stdio: 'pipe' })
    throw new Error('Malformed hook incorrectly passed.')
  } catch (error) {
    expect(error).toHaveProperty('status', 2)
  }
})

it('runs post-tool checks without formatting opaque shell changes or altering the index', async () => {
  const root = temporary()
  execFileSync('git', ['init', '-q'], { cwd: root })
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ private: true, scripts: { 'check:policy': 'node -e "process.exit(0)"', check: 'node -e "process.exit(0)"' } }),
  )
  writeFileSync(join(root, 'sample.ts'), 'const original=1\n')
  execFileSync('git', ['add', '.'], { cwd: root })
  const index = execFileSync('git', ['ls-files', '--stage'], { cwd: root, encoding: 'utf8' })
  writeFileSync(join(root, 'sample.ts'), 'const unformatted =   2\n')
  const result: unknown = await toolHook(
    JSON.stringify({ ...event(root, 'Bash', { command: 'opaque script' }), hook_event_name: 'PostToolUse', tool_response: { exit_code: 0 } }),
    root,
  )
  expect(z.object({ hookSpecificOutput: z.object({ additionalContext: z.string() }) }).parse(result).hookSpecificOutput.additionalContext).toContain('passed')
  expect(readFileSync(join(root, 'sample.ts'), 'utf8')).toBe('const unformatted =   2\n')
  expect(execFileSync('git', ['ls-files', '--stage'], { cwd: root, encoding: 'utf8' })).toBe(index)
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ private: true, scripts: { 'check:policy': 'node -e "console.error(\'failure\');process.exit(9)"' } }),
  )
  const failed: unknown = await toolHook(
    JSON.stringify({ ...event(root, 'Bash', { command: 'opaque script' }), hook_event_name: 'PostToolUse', tool_response: { exit_code: 0 } }),
    root,
  )
  expect(z.object({ decision: z.literal('block'), reason: z.string() }).parse(failed).reason).toContain('failure')
}, 20_000)
