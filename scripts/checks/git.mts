import { execFileSync } from 'node:child_process'
import { repositoryRoot } from './process.mts'

export function git(args: readonly string[], root: string, options: { readonly env?: NodeJS.ProcessEnv; readonly input?: string } = {}): string {
  return execFileSync('git', [...args], {
    cwd: root,
    env: options.env,
    input: options.input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  })
}

export function hasCommit(root: string, ref = 'HEAD'): boolean {
  try {
    git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`], root)
    return true
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'status' in error && error.status === 1) {
      return false
    }
    throw error
  }
}

export function cleanGitEnvironment(root: string): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const name of git(['rev-parse', '--local-env-vars'], root).trim().split('\n')) {
    delete env[name]
  }
  for (const name of Object.keys(env)) {
    if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(name)) {
      delete env[name]
    }
  }
  return env
}

export function repositoryFiles(root = repositoryRoot): readonly string[] {
  return git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], root).split('\0').filter(Boolean)
}

export function changedFiles(base?: string, root = repositoryRoot): readonly string[] {
  const files = (hasCommit(root) ? git(['diff', '--no-renames', '--name-only', '-z', 'HEAD', '--'], root) : git(['ls-files', '--cached', '-z'], root)).split(
    '\0',
  )
  files.push(...git(['ls-files', '--others', '--exclude-standard', '-z'], root).split('\0'))
  if (base !== undefined) {
    // Resolve as a ref argument, never interpolate it into shell code or Git options.
    const commit = git(['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`], root).trim()
    files.push(...git(['diff', '--no-renames', '--name-only', '-z', `${commit}...HEAD`, '--'], root).split('\0'))
  }
  return [...new Set(files.filter(Boolean))].sort()
}
