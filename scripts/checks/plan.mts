// Local verification and CI select from this same ordered catalogue.
import { protectedPolicyFile } from './protected.mts'
export type Profile = 'app' | 'pdf' | 'ops' | 'all'
export type Step = {
  readonly id: string
  readonly command: string
  readonly args: readonly string[]
  readonly cwd?: string
}

const pnpm = (id: string, ...args: string[]): Step => ({ id, command: 'pnpm', args })
const node = (id: string, script: string): Step => ({ id, command: process.execPath, args: [script] })
const cargo = (id: string, cwd: string, ...args: string[]): Step => ({ id, command: 'cargo', args, cwd })

export const steps = {
  docs: node('docs', 'scripts/checks/docs.mts'),
  policy: node('policy', 'scripts/checks/policy.mts'),
  format: { id: 'format', command: process.execPath, args: ['scripts/checks/format.mts', 'check'] },
  static: pnpm('static', 'check'),
  unit: pnpm('unit', 'test'),
  website: pnpm('website', '--filter', '@clausid/website', 'check'),
  build: pnpm('build', 'build'),
  astryx: pnpm('astryx', '--filter', '@clausid/web', 'exec', 'astryx', 'doctor', '--built', 'dist'),
  deployment: node('deployment', 'scripts/checks/deployment.mts'),
  browser: pnpm('browser', 'test:e2e'),
  pdfFormat: cargo('pdf-format', 'packages/pdf-engine', 'fmt', '--check'),
  pdfLint: cargo('pdf-lint', 'packages/pdf-engine', 'clippy', '--locked', '--all-targets', '--', '-D', 'warnings'),
  pdfTest: cargo('pdf-test', 'packages/pdf-engine', 'test', '--locked'),
  pdfBuild: { id: 'pdf-build', command: 'sh', args: ['build.sh'], cwd: 'packages/pdf-engine' },
  pdfSmoke: node('pdf-smoke', 'scripts/checks/pdfSmoke.mts'),
  opsFormat: cargo('ops-format', 'packages/ops', 'fmt', '--check'),
  opsLint: cargo('ops-lint', 'packages/ops', 'clippy', '--locked', '--all-targets', '--', '-D', 'warnings'),
  opsTest: cargo('ops-test', 'packages/ops', 'test', '--locked'),
  opsBuild: cargo('ops-build', 'packages/ops', 'build', '--locked', '--release'),
} as const satisfies Record<string, Step>

export function localPlan(): readonly Step[] {
  return [steps.docs, steps.policy, steps.format, steps.static, steps.unit]
}

export function profilePlan(profile: Profile): readonly Step[] {
  const app = [
    steps.docs,
    steps.policy,
    steps.format,
    steps.static,
    steps.unit,
    steps.website,
    steps.pdfBuild,
    steps.build,
    steps.astryx,
    steps.deployment,
    steps.browser,
  ]
  const pdf = [steps.docs, steps.pdfFormat, steps.pdfLint, steps.pdfTest, steps.pdfBuild, steps.pdfSmoke]
  const ops = [steps.docs, steps.opsFormat, steps.opsLint, steps.opsTest, steps.opsBuild]
  if (profile === 'app') {
    return app
  }
  if (profile === 'pdf') {
    return pdf
  }
  if (profile === 'ops') {
    return ops
  }
  return uniqueSteps([...app, ...pdf, ...ops])
}

function uniqueSteps(input: readonly Step[]): readonly Step[] {
  return [...new Map(input.map((step) => [step.id, step])).values()]
}

export type ChangedPlan = { readonly steps: readonly Step[]; readonly required: readonly Profile[] }

export function changedPlan(files: readonly string[], agent = false): ChangedPlan {
  const selected: Step[] = agent ? [...localPlan()] : [steps.docs]
  const required = new Set<Profile>()
  for (const file of files) {
    if (protectedPolicyFile(file)) {
      selected.push(steps.policy, steps.format, steps.static, steps.unit, steps.website, steps.pdfFormat, steps.pdfLint, steps.opsFormat, steps.opsLint)
      required.add('all')
      continue
    }
    // Markdown can be application content (for example Astro pages), not just documentation.
    if ((file.startsWith('docs/') && file.endsWith('.md')) || /(^|\/)(README|AGENTS|CLAUDE|LUMOS|THIRD_PARTY_NOTICES)\.md$/.test(file)) {
      continue
    }
    if (file.startsWith('apps/website/')) {
      selected.push(steps.website)
      required.add('app')
    } else if (file.startsWith('packages/pdf-engine/')) {
      selected.push(steps.static, steps.unit, steps.pdfFormat, steps.pdfLint)
      required.add('app')
      required.add('pdf')
    } else if (file.startsWith('packages/ops/')) {
      selected.push(steps.opsFormat, steps.opsLint)
      required.add('ops')
    } else if (/^(apps\/(web|worker|auth)\/|packages\/contracts\/|tests\/(?!verification))/.test(file)) {
      selected.push(steps.policy, steps.format, steps.static, steps.unit)
      required.add('app')
    } else {
      // Tooling, lockfiles, CI, deployment and unknown paths widen rather than skip checks.
      selected.push(steps.policy, steps.format, steps.static, steps.unit, steps.website, steps.pdfFormat, steps.pdfLint, steps.opsFormat, steps.opsLint)
      required.add('all')
    }
  }
  return { steps: uniqueSteps(selected), required: required.has('all') ? ['all'] : [...required] }
}
