import { chmodSync, existsSync, realpathSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { git } from '../checks/git.mts'
import { repositoryRoot } from '../checks/process.mts'

const names = ['pre-commit', 'commit-msg', 'pre-push'] as const

function configured(root: string): string | undefined {
  try {
    return git(['config', '--get', 'core.hooksPath'], root).trim()
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'status' in error && error.status === 1) {
      return undefined
    }
    throw error
  }
}

export function installHooks(root = repositoryRoot, optional = false): string {
  let top: string
  try {
    top = git(['rev-parse', '--show-toplevel'], root).trim()
  } catch (error) {
    if (optional) {
      return 'Clausid hooks: no Git checkout; installation skipped.'
    }
    throw error
  }
  if (realpathSync(top) !== realpathSync(root)) {
    if (optional) {
      return 'Clausid hooks: package is not the Git root; installation skipped.'
    }
    throw new Error('Install Clausid hooks only at this repository root.')
  }
  const current = configured(root)
  if (current && resolve(root, current) !== resolve(root, '.githooks')) {
    throw new Error(`Existing core.hooksPath (${current}) was preserved. Reconcile it before installing Clausid hooks.`)
  }
  for (const name of names) {
    if (!existsSync(join(root, '.githooks', name))) {
      throw new Error(`Missing .githooks/${name}.`)
    }
    if (!current) {
      const legacy = resolve(root, git(['rev-parse', '--git-path', `hooks/${name}`], root).trim())
      if (existsSync(legacy) && (statSync(legacy).mode & 0o111) !== 0) {
        throw new Error(`Existing executable hook ${legacy} was preserved. Reconcile it before installation.`)
      }
    }
  }
  for (const name of names) {
    chmodSync(join(root, '.githooks', name), 0o755)
  }
  git(['config', '--local', 'core.hooksPath', '.githooks'], root)
  return 'Clausid Git hooks installed: pre-commit, commit-msg, pre-push (repository-local configuration).'
}

export function hookStatus(root = repositoryRoot): string {
  const current = configured(root)
  const active =
    current !== undefined &&
    resolve(root, current) === resolve(root, '.githooks') &&
    names.every((name) => existsSync(join(root, '.githooks', name)) && (statSync(join(root, '.githooks', name)).mode & 0o111) !== 0)
  return `Clausid Git hooks: ${active ? 'active' : 'NOT active'}; core.hooksPath=${current ?? '(default)'}. Agent trust/status is separate.`
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const argument = process.argv[2]
    if (argument && !['--if-available', '--status'].includes(argument)) {
      throw new Error('Expected --if-available or --status.')
    }
    console.log(argument === '--status' ? hookStatus() : installHooks(repositoryRoot, argument === '--if-available'))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
