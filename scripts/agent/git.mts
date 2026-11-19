import { git } from '../checks/git.mts'
import { runGitHook } from './gitHooks.mts'
import { readInput } from './input.mts'

async function main() {
  const [event, ...args] = process.argv.slice(2)
  const root = git(['rev-parse', '--show-toplevel'], process.cwd()).trim()
  await runGitHook(event ?? '', args, event === 'pre-push' ? readInput(64 * 1024) : '', root)
}
main().catch((error) => {
  console.error(`Clausid Git hook: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
