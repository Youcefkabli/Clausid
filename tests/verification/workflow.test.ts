// Verify conservative change routing, real Git states and subprocess failures without app services.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { changedPlan, profilePlan } from '../../scripts/checks/plan.mts'
import { changedFiles } from '../../scripts/checks/git.mts'
import { documentProblems } from '../../scripts/checks/docs.mts'
import { runCommand } from '../../scripts/checks/process.mts'
import { repositoryRoot } from '../../scripts/checks/process.mts'

const scratch: string[] = []
function temporary() {
  const directory = mkdtempSync(join(tmpdir(), 'clausid-verification-'))
  scratch.push(directory)
  return directory
}
afterEach(() => {
  for (const directory of scratch.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('verification routing', () => {
  it('keeps documentation checks small and routes shared contracts to application verification', () => {
    expect(changedPlan(['docs/architecture.md', 'docs/specs/CSD-001/spec.md']).steps.map((step) => step.id)).toEqual(['docs'])
    const plan = changedPlan(['packages/contracts/src/index.ts'])
    expect(plan.steps.map((step) => step.id)).toEqual(['docs', 'policy', 'format', 'static', 'unit'])
    expect(plan.required).toEqual(['app'])
  })
  it('checks website source and both consumers of PDF changes', () => {
    expect(changedPlan(['apps/website/src/pages/index.astro']).steps.map((step) => step.id)).toEqual(['docs', 'website'])
    expect(changedPlan(['apps/website/src/pages/article.md']).required).toEqual(['app'])
    expect(changedPlan(['new-runtime-content.md']).required).toEqual(['all'])
    expect(changedPlan(['packages/pdf-engine/src/lib.rs']).required).toEqual(['app', 'pdf'])
    expect(changedPlan(['packages/ops/src/main.rs']).required).toEqual(['ops'])
  })
  it('widens unknown paths, lockfiles and gate edits, with no duplicate steps', () => {
    for (const file of ['pnpm-lock.yaml', 'scripts/checks/plan.mts', '.github/workflows/ci.yml', 'future/package.json']) {
      expect(changedPlan([file]).required).toEqual(['all'])
      expect(changedPlan([file]).steps.map((step) => step.id)).toContain('website')
      expect(changedPlan([file]).steps.map((step) => step.id)).toContain('pdf-lint')
    }
    const ids = profilePlan('all').map((step) => step.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('astryx')
    expect(ids).toContain('deployment')
    expect(ids).toContain('browser')
    expect(ids).toContain('pdf-smoke')
    expect(ids).toContain('ops-build')
    expect(ids.indexOf('pdf-build')).toBeLessThan(ids.indexOf('build'))
  })
})

it('includes staged, unstaged, deleted, renamed, untracked and base-branch changes', () => {
  const root = temporary()
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  git('init', '-q')
  git('config', 'user.email', 'verification@example.test')
  git('config', 'user.name', 'Verification fixture')
  for (const file of ['staged.ts', 'unstaged.ts', 'deleted.ts', 'old.ts']) {
    writeFileSync(join(root, file), file)
  }
  git('add', '.')
  git('commit', '-qm', 'fixture baseline')
  const base = git('rev-parse', 'HEAD')
  writeFileSync(join(root, 'committed.ts'), 'new')
  git('add', '.')
  git('commit', '-qm', 'fixture branch change')
  writeFileSync(join(root, 'staged.ts'), 'staged change')
  git('add', 'staged.ts')
  writeFileSync(join(root, 'unstaged.ts'), 'unstaged change')
  rmSync(join(root, 'deleted.ts'))
  renameSync(join(root, 'old.ts'), join(root, 'new name.ts'))
  writeFileSync(join(root, 'untracked.ts'), 'untracked')
  expect(changedFiles(base, root)).toEqual(['committed.ts', 'deleted.ts', 'new name.ts', 'old.ts', 'staged.ts', 'unstaged.ts', 'untracked.ts'])
  expect(() => changedFiles('missing-ref', root)).toThrow()
})

it('checks documentation targets and metadata without treating fenced examples as links', () => {
  const root = temporary()
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'README.md'), '# Fixture')
  expect(documentProblems('docs/index.md', '[Home](../README.md#fixture)\n[Web](https://example.test)', root)).toEqual([])
  expect(documentProblems('docs/index.md', '```md\n[Example](missing.md)\n```', root)).toEqual([])
  expect(documentProblems('docs/index.md', '[Missing](missing.md)', root)).toHaveLength(1)
  expect(documentProblems('docs/index.md', '[Outside](../../outside)', root)).toHaveLength(1)
  expect(documentProblems('docs/index.md', '[Bad](%ZZ)', root)).toHaveLength(1)
  expect(documentProblems('docs/specs/CSD-001/spec.md', '# Missing metadata', root)).toHaveLength(4)
})

it('propagates child failure and enforces a time limit', async () => {
  await expect(runCommand({ id: 'fixture-failure', command: process.execPath, args: ['-e', 'process.exit(7)'] })).rejects.toThrow('exit 7')
  await expect(runCommand({ id: 'fixture-timeout', command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] }, temporary(), 30)).rejects.toThrow(
    'timeout',
  )
  await expect(runCommand({ id: 'fixture-missing', command: '/nonexistent/clausid-command', args: [] })).rejects.toThrow()
})

it('passes arguments literally instead of evaluating shell syntax', async () => {
  const argument = 'spaces; $(false) `false`'
  await runCommand({
    id: 'fixture-arguments',
    command: process.execPath,
    args: ['-e', 'if (process.argv[1] !== "spaces; $(false) `false`") process.exit(2)', argument],
  })
})

it('never reports an interrupted command as passing even if the child exits zero', () => {
  const module = pathToFileURL(join(repositoryRoot, 'scripts/checks/process.mts')).href
  const marker = join(temporary(), 'child-ready')
  const script = `
    import { runCommand } from ${JSON.stringify(module)};
    import { existsSync } from 'node:fs';
    import { setTimeout as delay } from 'node:timers/promises';
    const marker = ${JSON.stringify(marker)};
    const command = runCommand({ id: 'interrupted', command: process.execPath, args: [
      '-e', 'process.on("SIGTERM", () => process.exit(0)); require("node:fs").writeFileSync(process.argv[1], "ready"); setInterval(() => {}, 1000)', marker
    ] }, undefined, 3000);
    command.catch(() => {});
    for (let attempt = 0; attempt < 100 && !existsSync(marker); attempt++) await delay(20);
    if (!existsSync(marker)) throw new Error('Child did not become ready.');
    process.kill(process.pid, 'SIGTERM');
    try {
      await command;
    } catch { process.exitCode = 3; }
  `
  try {
    execFileSync(process.execPath, ['--input-type=module', '-e', script], { stdio: 'pipe', timeout: 5_000 })
    throw new Error('An interrupted gate incorrectly passed.')
  } catch (error) {
    expect(error).toHaveProperty('status', 3)
  }
})
