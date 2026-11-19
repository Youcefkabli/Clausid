// Deliberately violate each custom policy and prove the valid counterpart passes without a legacy baseline.
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vite-plus/test'
import { dependencyProblems, exceptionProblems, sourceProblems } from '../../scripts/checks/policy.mts'
import type { PolicyException } from '../../scripts/checks/policy.mts'
import { editFormatPaths, maintainedFormatFile } from '../../scripts/checks/format.mts'
import { documentProblems } from '../../scripts/checks/docs.mts'
import { protectedPolicyFile } from '../../scripts/checks/protected.mts'
import { changedPlan } from '../../scripts/checks/plan.mts'

const scratch: string[] = []
function temporary() {
  const root = mkdtempSync(join(tmpdir(), "clausid policy's "))
  scratch.push(root)
  return root
}
afterEach(() => {
  for (const root of scratch.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})
const rules = (text: string, file = 'apps/web/src/example.ts') => sourceProblems(file, text, '/repo').map((item) => item.rule)

it('rejects unsafe constructs and accepts narrowing, literal unions and const values', () => {
  for (const [text, rule] of [
    ['let value: any', 'no-any'],
    ['enum Mode {Read}', 'no-enum'],
    ['const value = input!', 'no-non-null'],
    ['const value = input as string', 'type-assertion'],
    ['const value = <string>input', 'type-assertion'],
    ['function update(value: Partial<Config>) {}', 'no-partial'],
    ['response.json<Data>()', 'typed-json'],
  ] as const) {
    expect(rules(text)).toContain(rule)
  }
  expect(rules("const mode = 'Read' as const; const value: unknown = input; if (typeof value === 'string') value.trim()")).toEqual([])
})

it('enforces layers through relative paths, re-exports, dynamic imports and workspace aliases', () => {
  for (const text of ["import x from '../../worker/src/http.ts'", "export * from '../../worker/src/http.ts'", "import('@clausid/worker/http')"]) {
    expect(rules(text)).toContain('source-layer')
  }
  expect(rules("import type { View } from '@clausid/contracts'")).toEqual([])
  expect(rules("import x from '../../auth/src/policy.ts'", 'apps/worker/src/cloudflare.ts')).toEqual([])
  expect(rules("import x from '../../auth/src/server.ts'", 'apps/worker/src/cloudflare.ts')).toContain('source-layer')
  expect(rules("import x from '../../../apps/worker/src/http.ts'", 'packages/contracts/src/index.ts')).toContain('source-layer')
})

it('checks actual suppression comments and test purpose, leaving quoted examples alone', () => {
  expect(rules("const text = '// @ts-ignore'; const enumExample = 'enum X {}'")).toEqual([])
  expect(rules('// @ts-ignore\nconst x=1')).toContain('compiler-suppression')
  expect(rules('// @ts-expect-error\nconst x=1')).toContain('compiler-suppression')
  expect(rules('// @ts-expect-error: reject deliberately invalid input in this fixture\nconst x=1')).toEqual([])
  expect(rules('// eslint-disable -- a long reason cannot authorize all rules')).toContain('lint-suppression')
  expect(rules('// oxlint-disable-next-line typescript/no-unsafe-assignment -- Narrow platform adapter covered by a real boundary test.')).toEqual([])
  expect(rules('import {it} from "test"', 'tests/example.test.ts')).toContain('test-purpose')
  expect(rules('// Verify rejected values through real producer fixtures.\nconst x=1', 'tests/example.test.ts')).toEqual([])
})

it('requires exact, non-stale adapter exceptions with tests and reasons', () => {
  const root = temporary()
  writeFileSync(join(root, 'adapter.ts'), 'export function adapter(value: unknown) {return value as string}')
  writeFileSync(join(root, 'adapter.test.ts'), '// Validate adapter invariants with invalid inputs.\n')
  const entry: PolicyException = {
    rule: 'type-assertion',
    file: 'adapter.ts',
    symbol: 'adapter',
    test: 'adapter.test.ts',
    reason: 'The validated adapter retains its checked representation and has failure fixtures.',
  }
  const files = ['adapter.ts', 'adapter.test.ts']
  expect(exceptionProblems([entry], files, root)).toEqual([])
  expect(sourceProblems(entry.file, 'export function adapter(value: unknown) {return value as string}', root, [entry])).toEqual([])
  expect(exceptionProblems([{ ...entry, symbol: 'other' }], files, root).join()).toContain('Stale')
  expect(exceptionProblems([{ ...entry, file: '*.ts' }], files, root).join()).toContain('Invalid')
  expect(exceptionProblems([{ ...entry, test: 'missing.test.ts' }], files, root).join()).toContain('Invalid')
  expect(exceptionProblems([entry, entry], files, root).join()).toContain('Duplicate')
  expect(exceptionProblems([{ ...entry, reason: 'short' }], files, root).join()).toContain('Invalid')
  writeFileSync(join(root, 'adapter.ts'), "export function adapter(){return 'value' as const}")
  expect(exceptionProblems([entry], files, root).join()).toContain('Stale')
})

it('keeps dependency decisions exact and structurally complete', () => {
  const record = '### `npm:zod`\n**Does:** parse\n**Why not the platform:** schemas\n**Cost:** runtime\n'
  expect(dependencyProblems(['npm:zod'], record)).toEqual([])
  expect(dependencyProblems(['npm:other'], record)).toHaveLength(2)
  expect(dependencyProblems(['npm:zod'], record + record).join()).toContain('Duplicate')
  expect(dependencyProblems(['npm:zod'], '### `npm:zod`').join()).toContain('Cost')
})

it('widens protected documentation/configuration before documentation-only routing', () => {
  for (const file of [
    'AGENTS.md',
    'apps/web/AGENTS.md',
    'docs/coding-standards.md',
    'docs/dependencies.md',
    '.codex/hooks.json',
    'scripts/checks/protected.mts',
    'tsconfig.base.json',
  ]) {
    expect(protectedPolicyFile(file)).toBe(true)
    expect(changedPlan([file]).required).toEqual(['all'])
    expect(changedPlan([file]).steps.map((step) => step.id)).toContain('policy')
  }
  expect(changedPlan(['docs/collaboration-and-review.md']).required).toEqual([])
})

it('formats only explicit files in the worktree, including quoted names, without following outside symlinks', () => {
  const root = temporary(),
    outside = temporary()
  mkdirSync(join(root, 'nested'))
  writeFileSync(join(root, "nested/it's a file.ts"), 'const x=1')
  writeFileSync(join(outside, 'outside.ts'), 'const x=1')
  symlinkSync(join(outside, 'outside.ts'), join(root, 'escape.ts'))
  expect(editFormatPaths(["nested/it's a file.ts", 'escape.ts', 'missing.ts', 'nested'], root)).toEqual(["nested/it's a file.ts"])
  for (const file of ['apps/website/src/page.astro', 'docs/archive/old.md', 'generated.d.ts', 'target/x.json', 'pnpm-lock.yaml']) {
    expect(maintainedFormatFile(file)).toBe(false)
  }
})

it('checks local anchors, reference definitions and named-program metadata', () => {
  const root = temporary()
  writeFileSync(join(root, 'target.md'), '# A heading\n# A heading\n<a id="explicit"></a>')
  expect(documentProblems('index.md', '[A][ref]\n[ref]: target.md#a-heading-1', root)).toEqual([])
  expect(documentProblems('index.md', '[A](target.md#explicit)', root)).toEqual([])
  expect(documentProblems('index.md', '[A](target.md#missing)', root)).toHaveLength(1)
  expect(documentProblems('index.md', '[A][missing]', root)).toHaveLength(1)
  expect(documentProblems('docs/prompt.md', '# Missing metadata', root)).toHaveLength(4)
  expect(
    documentProblems(
      'docs/clausid-engineering-tracker.md',
      'Status: Complete\nOwner: X\nIssue: X\nVerified against: X\n| 01 | Output | None | Pending | Missing |',
      root,
    ).join(),
  ).toContain('unfinished')
})
