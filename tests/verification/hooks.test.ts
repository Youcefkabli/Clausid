// Exercise actual hooks in disposable Git repositories, including staged/pushed content and bounded agent retries.
import { z } from 'zod'
import { requiredValue } from '../../packages/contracts/src/invariant.ts'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vite-plus/test'
import { completion, decideFailure, findingDigest, parseEvent } from '../../scripts/agent/completion.mts'
import { hookStatus, installHooks } from '../../scripts/agent/install.mts'
import { messageProblem, parsePushes, pushCommands } from '../../scripts/agent/gitHooks.mts'
import { changedPlan } from '../../scripts/checks/plan.mts'
import { git } from '../../scripts/checks/git.mts'
import { repositoryRoot } from '../../scripts/checks/process.mts'
import { createSnapshot } from '../../scripts/checks/snapshot.mts'

const scratch: string[] = []
const emptyId = '0'.repeat(40)
function temporary() {
  const path = mkdtempSync(join(tmpdir(), "clausid hook's fixture "))
  scratch.push(path)
  return path
}
afterEach(() => {
  for (const path of scratch.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

function fixture(value = 'valid') {
  const root = temporary()
  for (const directory of ['scripts/checks', 'scripts/agent', '.githooks']) {
    cpSync(join(repositoryRoot, directory), join(root, directory), { recursive: true })
  }
  for (const name of ['pre-commit', 'commit-msg', 'pre-push']) {
    chmodSync(join(root, '.githooks', name), 0o755)
  }
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n.data/\n')
  const scripts = Object.fromEntries(
    ['check:changed', 'check:docs', 'verify', 'verify:all', 'verify:pdf', 'verify:ops'].map((name) => [name, 'node verify.mjs']),
  )
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'clausid-hook-fixture', private: true, type: 'module', scripts }))
  writeFileSync(join(root, 'value.txt'), value)
  mkdirSync(join(root, 'packages/contracts'), { recursive: true })
  writeFileSync(join(root, 'packages/contracts/package.json'), JSON.stringify({ name: '@clausid/contracts', type: 'module', exports: './index.mjs' }))
  writeFileSync(join(root, 'packages/contracts/index.mjs'), 'export const value = "valid"')
  mkdirSync(join(root, 'node_modules/@clausid'), { recursive: true })
  symlinkSync(join(root, 'packages/contracts'), join(root, 'node_modules/@clausid/contracts'))
  writeFileSync(
    join(root, 'verify.mjs'),
    `
    import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
    import { value } from '@clausid/contracts';
    mkdirSync('.data', { recursive: true });
    writeFileSync('.data/check-args.json', JSON.stringify(process.argv.slice(2)));
    if (readFileSync('value.txt', 'utf8') !== 'valid' || value !== 'valid') {
      console.error('fixture validation failed'); process.exitCode = 9;
    }
  `,
  )
  git(['init', '-q'], root)
  git(['config', 'user.name', 'Hook fixture'], root)
  git(['config', 'user.email', 'hooks@example.test'], root)
  git(['config', 'commit.gpgsign', 'false'], root)
  git(['add', '.'], root)
  git(['commit', '-qm', 'Fixture baseline'], root)
  return root
}

it('installs idempotently and preserves existing custom hooks', () => {
  const root = fixture()
  expect(installHooks(root)).toContain('installed')
  expect(installHooks(root)).toContain('installed')
  expect(hookStatus(root)).toContain('active;')
  git(['config', '--local', 'core.hooksPath', 'custom-hooks'], root)
  expect(() => installHooks(root)).toThrow('preserved')
  expect(git(['config', '--get', 'core.hooksPath'], root).trim()).toBe('custom-hooks')
  const legacy = fixture()
  writeFileSync(join(legacy, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  expect(() => installHooks(legacy)).toThrow('Existing executable hook')
  expect(readFileSync(join(legacy, '.git/hooks/pre-commit'), 'utf8')).toContain('exit 0')
  expect(installHooks(temporary(), true)).toContain('skipped')
})

it('blocks an invalid staged version even when the working copy is fixed', () => {
  const root = fixture()
  installHooks(root)
  writeFileSync(join(root, 'value.txt'), 'broken')
  git(['add', 'value.txt'], root)
  writeFileSync(join(root, 'value.txt'), 'valid')
  writeFileSync(join(root, 'untracked.txt'), 'keep this')
  const before = git(['status', '--porcelain'], root)
  expect(() => git(['commit', '-m', 'Validate staged content'], root)).toThrow()
  expect(git(['status', '--porcelain'], root)).toBe(before)
  expect(readFileSync(join(root, 'untracked.txt'), 'utf8')).toBe('keep this')
}, 20_000)

it('allows valid staged content while preserving a broken unstaged working copy', () => {
  const root = fixture()
  installHooks(root)
  writeFileSync(join(root, 'extra.txt'), 'staged')
  git(['add', 'extra.txt'], root)
  writeFileSync(join(root, 'value.txt'), 'broken')
  git(['commit', '-qm', 'Validate the staged snapshot'], root)
  expect(git(['show', 'HEAD:value.txt'], root)).toBe('valid')
  expect(readFileSync(join(root, 'value.txt'), 'utf8')).toBe('broken')
}, 20_000)

it('resolves workspace dependencies to staged source instead of unstaged fixes', () => {
  const root = fixture()
  installHooks(root)
  writeFileSync(join(root, 'packages/contracts/index.mjs'), 'export const value = "broken"')
  git(['add', 'packages/contracts/index.mjs'], root)
  writeFileSync(join(root, 'packages/contracts/index.mjs'), 'export const value = "valid"')
  expect(() => git(['commit', '-m', 'Validate staged dependency'], root)).toThrow()
}, 20_000)

it('blocks bad pushed commits despite uncommitted fixes, using a real local bare remote', () => {
  const root = fixture('broken')
  installHooks(root)
  writeFileSync(join(root, 'value.txt'), 'valid')
  const remote = temporary()
  git(['init', '--bare', '-q', remote], root)
  expect(() => git(['push', remote, 'HEAD:refs/heads/fixture'], root)).toThrow()
  expect(git(['ls-remote', remote], root).trim()).toBe('')
  expect(readFileSync(join(root, 'value.txt'), 'utf8')).toBe('valid')
}, 20_000)

it('allows a valid local push and a subsequent deletion without checking dirty source', () => {
  const root = fixture()
  installHooks(root)
  const remote = temporary()
  git(['init', '--bare', '-q', remote], root)
  git(['push', remote, 'HEAD:refs/heads/fixture'], root)
  expect(git(['ls-remote', remote, 'refs/heads/fixture'], root)).toContain(git(['rev-parse', 'HEAD'], root).trim())
  writeFileSync(join(root, 'value.txt'), 'broken')
  git(['push', remote, ':refs/heads/fixture'], root)
  expect(git(['ls-remote', remote], root).trim()).toBe('')
}, 20_000)

it('routes known pushes, tags and deletes conservatively', () => {
  const root = fixture()
  const first = git(['rev-parse', 'HEAD'], root).trim()
  mkdirSync(join(root, 'apps/web/src'), { recursive: true })
  writeFileSync(join(root, 'apps/web/src/fixture.ts'), 'export {}')
  git(['add', '.'], root)
  git(['commit', '-qm', 'Fixture application change'], root)
  const tip = git(['rev-parse', 'HEAD'], root).trim()
  const push = { localRef: 'HEAD', local: tip, remoteRef: 'refs/heads/main', remote: first }
  expect(pushCommands(push, root)).toEqual(['verify'])
  expect(pushCommands({ ...push, remote: emptyId }, root)).toEqual(['verify:all'])
  expect(pushCommands({ ...push, remoteRef: 'refs/tags/v1' }, root)).toEqual(['verify:all'])
  expect(pushCommands({ ...push, local: emptyId }, root)).toEqual([])
  expect(parsePushes(`HEAD ${tip} refs/heads/main ${first}\n`)).toHaveLength(1)
  expect(() => parsePushes('bad input')).toThrow()
  expect(() => parsePushes(`HEAD ${tip} main ${first}`)).toThrow()
})

it('checks commit messages without imposing a conventional-commit prefix', () => {
  expect(messageProblem('Add a bounded signing check\n')).toBeUndefined()
  expect(messageProblem('Fix review retries\n\nExplain the reason.\n')).toBeUndefined()
  expect(messageProblem('')).toContain('non-empty')
  expect(messageProblem('x'.repeat(73))).toContain('72')
  expect(messageProblem('Subject\nBody')).toContain('blank line')
  const root = fixture()
  installHooks(root)
  writeFileSync(join(root, 'extra.txt'), 'new')
  git(['add', 'extra.txt'], root)
  expect(() => git(['commit', '-m', 'x'.repeat(73)], root)).toThrow()
}, 20_000)

it('disposes snapshots and supports inherited index/worktree Git variables', () => {
  const root = fixture()
  const snapshot = createSnapshot(root, { kind: 'staged' })
  expect(readFileSync(join(snapshot.root, 'value.txt'), 'utf8')).toBe('valid')
  expect(snapshot['env']['GIT_INDEX_FILE']).toBeUndefined()
  expect(snapshot['env']['GIT_DIR']).toBeUndefined()
  snapshot.dispose()
  expect(existsSync(snapshot.root)).toBe(false)
  installHooks(root)
  const alternate = join(root, '.git', 'alternate-index')
  cpSync(join(root, '.git', 'index'), alternate)
  const env = { ...process.env, GIT_DIR: join(root, '.git'), GIT_WORK_TREE: root, GIT_INDEX_FILE: alternate }
  writeFileSync(join(root, 'value.txt'), 'broken')
  git(['add', 'value.txt'], root, { env })
  writeFileSync(join(root, 'value.txt'), 'valid')
  const originalIndex = readFileSync(join(root, '.git/index'))
  expect(() => git(['commit', '-m', 'Check the alternate index'], root, { env })).toThrow()
  expect(readFileSync(join(root, '.git/index'))).toEqual(originalIndex)
}, 20_000)

it('keeps package-local binary shim directories outside workspace source remapping', () => {
  const root = fixture()
  mkdirSync(join(root, 'apps/web/node_modules/.bin'), { recursive: true })
  writeFileSync(join(root, 'apps/web/package.json'), '{}')
  writeFileSync(join(root, 'apps/web/node_modules/.bin/fixture'), '#!/bin/sh\nexit 0\n')
  git(['add', 'apps/web/package.json'], root)
  const snapshot = createSnapshot(root, { kind: 'staged' })
  try {
    expect(realpathSync(join(snapshot.root, 'apps/web/node_modules/.bin'))).toBe(realpathSync(join(root, 'apps/web/node_modules/.bin')))
    expect(realpathSync(join(snapshot.root, 'node_modules/@clausid/contracts'))).toBe(realpathSync(join(snapshot.root, 'packages/contracts')))
  } finally {
    snapshot.dispose()
  }
})

it('runs both completion adapters and stops retrying identical failures without claiming success', async () => {
  for (const harness of ['codex', 'claude'] as const) {
    const root = fixture()
    const payload = (active = false) => JSON.stringify({ session_id: '../session', cwd: root, hook_event_name: 'Stop', stop_hook_active: active })
    const start = JSON.stringify({ session_id: '../session', cwd: root, hook_event_name: 'SessionStart' })
    await completion(harness, 'start', start, root)
    const base = git(['rev-parse', 'HEAD'], root).trim()
    expect((await completion(harness, 'stop', payload(), root)).decision).toBeUndefined()
    expect(JSON.parse(readFileSync(join(root, '.data/check-args.json'), 'utf8'))).toEqual(['--agent', '--base', base])
    writeFileSync(join(root, 'value.txt'), 'broken')
    for (let attempt = 0; attempt < 3; attempt++) {
      expect((await completion(harness, 'stop', payload(attempt > 0), root)).decision).toBe('block')
    }
    const released = await completion(harness, 'stop', payload(true), root)
    expect(released.systemMessage).toContain('STILL FAILING')
    expect(released.decision).toBeUndefined()
    writeFileSync(join(root, 'value.txt'), 'valid')
    expect((await completion(harness, 'stop', payload(true), root)).systemMessage).toContain('checks passed')
    const state = join(root, '.data/agent-hooks', requiredValue(readdirSync(join(root, '.data/agent-hooks'))[0]))
    expect(statSync(state).mode & 0o777).toBe(0o600)
    expect(z.object({ refusals: z.number() }).parse(JSON.parse(readFileSync(state, 'utf8'))).refusals).toBe(0)
  }
}, 30_000)

it('bounds changing findings and validates hook input/output', () => {
  let state = { refusals: 0, chain: 0, released: false }
  for (let index = 0; index < 6; index++) {
    const result = decideFailure(state, String(index), index > 0)
    expect(result.release).toBe(false)
    state = result.state
  }
  expect(decideFailure(state, 'new', true).release).toBe(true)
  expect(findingDigest('Duration 5s\nerror at line 5')).toBe(findingDigest('Duration 9s\nerror at line 5'))
  expect(findingDigest('(node:123) Warning: color options conflict\nerror at line 5')).toBe(
    findingDigest('(node:456) Warning: color options conflict\nerror at line 5'),
  )
  expect(() => parseEvent('{}', 'stop')).toThrow()
  expect(changedPlan([], true).steps.map((step) => step.id)).toEqual(['docs', 'policy', 'format', 'static', 'unit'])
  const output = execFileSync(process.execPath, [join(repositoryRoot, 'scripts/agent/hooks.mts'), 'codex', 'stop'], { input: '{}', encoding: 'utf8' })
  expect(z.object({ continue: z.boolean() }).parse(JSON.parse(output)).continue).toBe(false)
  expect(z.object({ systemMessage: z.string() }).parse(JSON.parse(output)).systemMessage).toContain('could not verify')
})

it('executes both configured command strings from a nested directory with spaces and quotes', () => {
  const root = fixture()
  mkdirSync(join(root, 'apps/web'), { recursive: true })
  for (const [harness, file] of [
    ['codex', '.codex/hooks.json'],
    ['claude', '.claude/settings.json'],
  ] as const) {
    const configuration = z
      .object({ hooks: z.record(z.string(), z.array(z.object({ hooks: z.array(z.object({ command: z.string() })) }))) })
      .parse(JSON.parse(readFileSync(join(repositoryRoot, file), 'utf8')))
    for (const [event, active] of [
      ['SessionStart', undefined],
      ['Stop', false],
    ]) {
      const command = requiredValue(requiredValue(requiredValue(configuration.hooks[String(event)])[0]).hooks[0]).command
      const output = execFileSync('/bin/sh', ['-c', command], {
        cwd: join(root, 'apps/web'),
        encoding: 'utf8',
        input: JSON.stringify({ session_id: harness, cwd: root, hook_event_name: event, stop_hook_active: active }),
      })
      const result = z.object({ decision: z.string().optional(), systemMessage: z.string().optional() }).parse(JSON.parse(output))
      expect(result.decision).toBeUndefined()
      if (event === 'Stop') {
        expect(result.systemMessage).toContain('checks passed')
      }
    }
  }
}, 20_000)
