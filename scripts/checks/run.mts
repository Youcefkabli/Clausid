import { changedFiles } from './git.mts'
import { changedPlan, localPlan, profilePlan } from './plan.mts'
import { runCommand } from './process.mts'

async function main() {
  const [mode, ...args] = process.argv.slice(2)
  if (mode !== 'local' && mode !== 'changed' && mode !== 'app' && mode !== 'pdf' && mode !== 'ops' && mode !== 'all') {
    throw new Error('Expected local, changed, app, pdf, ops or all.')
  }
  let base: string | undefined
  let planOnly = false
  let agent = false
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--plan') {
      planOnly = true
    } else if (args[index] === '--agent' && mode === 'changed') {
      agent = true
    } else if (args[index] === '--base' && mode === 'changed' && args[index + 1] && !args[index + 1]?.startsWith('-')) {
      base = args[++index]
    } else {
      throw new Error(`Unknown or incomplete argument: ${args[index]}`)
    }
  }
  const files = mode === 'changed' ? changedFiles(base) : undefined
  const plan = files ? changedPlan(files, agent) : undefined
  const selected = plan?.steps ?? (mode === 'changed' ? [] : mode === 'local' ? localPlan() : profilePlan(mode))
  if (planOnly) {
    console.log(JSON.stringify({ mode, files, steps: selected, required: plan?.required }, null, 2))
    return
  }
  for (const step of selected) {
    await runCommand(step)
  }
  console.log(`\n${mode}: selected checks passed.`)
  if (plan) {
    console.log('Changed-file checks do not qualify a release or replace integration verification.')
    for (const profile of plan.required) {
      console.log(`Before integration run pnpm ${profile === 'app' ? 'verify' : `verify:${profile}`}.`)
    }
  } else {
    console.log('Hosted staging, recovery and release qualification remain separate.')
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
