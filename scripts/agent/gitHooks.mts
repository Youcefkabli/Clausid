import { readFileSync } from 'node:fs'
import { changedPlan } from '../checks/plan.mts'
import { git, hasCommit } from '../checks/git.mts'
import { createSnapshot } from '../checks/snapshot.mts'
import { repositoryRoot, runCommand } from '../checks/process.mts'

const zero = /^0+$/
const objectId = /^[a-f\d]{40}(?:[a-f\d]{24})?$/
export type Push = { readonly localRef: string; readonly local: string; readonly remoteRef: string; readonly remote: string }

export function parsePushes(input: string): readonly Push[] {
  if (Buffer.byteLength(input) > 64 * 1024) {
    throw new Error('Push ref input exceeds its size limit.')
  }
  const lines = input.split('\n').filter(Boolean)
  if (lines.length > 128) {
    throw new Error('A push may verify at most 128 refs at a time.')
  }
  return lines.map((line) => {
    const fields = line.trim().split(/\s+/)
    const [localRef, local, remoteRef, remote] = fields
    if (
      fields.length !== 4 ||
      !localRef ||
      !local ||
      !remoteRef ||
      !remote ||
      !objectId.test(local) ||
      !objectId.test(remote) ||
      !remoteRef.startsWith('refs/') ||
      /[\0\x7f]/.test(localRef + remoteRef)
    ) {
      throw new Error('Invalid pre-push ref input.')
    }
    return { localRef, local, remoteRef, remote }
  })
}

export function messageProblem(source: string): string | undefined {
  const lines = source
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !line.startsWith('#'))
  const subject = lines[0]?.trim() ?? ''
  if (!subject) {
    return 'Write a non-empty commit subject.'
  }
  if (Array.from(subject).length > 72) {
    return 'Keep the commit subject within 72 characters.'
  }
  if (lines.length > 1 && lines[1]?.trim()) {
    return 'Separate the commit subject and body with a blank line.'
  }
  return undefined
}

export function pushCommands(push: Push, root: string): readonly string[] {
  if (zero.test(push.local)) {
    return []
  }
  if (push.localRef.startsWith('refs/tags/') || push.remoteRef.startsWith('refs/tags/') || zero.test(push.remote) || !hasCommit(root, push.remote)) {
    return ['verify:all']
  }
  const files = git(['diff', '--no-renames', '--name-only', '-z', push.remote, push.local, '--'], root).split('\0').filter(Boolean)
  const { required } = changedPlan(files)
  if (!required.length) {
    return ['check:docs']
  }
  return required.map((profile) => (profile === 'app' ? 'verify' : `verify:${profile}`))
}

export async function preCommit(root: string) {
  const before = git(['ls-files', '--stage', '-z'], root)
  const snapshot = createSnapshot(root, { kind: 'staged' })
  try {
    await runCommand({ id: 'staged-checks', command: 'pnpm', args: ['check:changed'] }, snapshot.root, undefined, { env: snapshot.env })
    if (git(['ls-files', '--stage', '-z'], root) !== before) {
      throw new Error('The staged index changed during verification; retry the commit.')
    }
  } finally {
    snapshot.dispose()
  }
}

export async function prePush(root: string, input: string) {
  const targets = new Map<string, Set<string>>()
  for (const push of parsePushes(input)) {
    if (zero.test(push.local)) {
      continue
    }
    const commit = git(['rev-parse', '--verify', '--end-of-options', `${push.local}^{commit}`], root).trim()
    const commands = targets.get(commit) ?? new Set<string>()
    for (const command of pushCommands(push, root)) {
      commands.add(command)
    }
    targets.set(commit, commands)
  }
  for (const [commit, selected] of targets) {
    const commands = selected.has('verify:all') ? ['verify:all'] : [...selected]
    const snapshot = createSnapshot(root, { kind: 'commit', commit })
    try {
      console.log(`Clausid: verifying pushed commit ${commit}.`)
      for (const command of commands) {
        await runCommand({ id: `push-${command}`, command: 'pnpm', args: [command] }, snapshot.root, undefined, {
          // Browser tests target Mailpit, never an inherited production SMTP endpoint.
          env: { ...snapshot.env, CLAUSID_DATA_DIR: snapshot.root + '/.data/e2e', SMTP_HOST: '127.0.0.1', SMTP_PORT: '1025' },
        })
      }
      if (git(['diff', '--name-only', 'HEAD', '--'], snapshot.root, { env: snapshot.env }).trim()) {
        throw new Error('Verification changed tracked files in the pushed snapshot.')
      }
    } finally {
      snapshot.dispose()
    }
  }
}

export async function runGitHook(event: string, args: readonly string[], input: string, root = repositoryRoot) {
  if (event === 'pre-commit') {
    await preCommit(root)
  } else if (event === 'pre-push') {
    await prePush(root, input)
  } else if (event === 'commit-msg') {
    if (!args[0]) {
      throw new Error('commit-msg requires a message file.')
    }
    const problem = messageProblem(readFileSync(args[0], 'utf8'))
    if (problem) {
      throw new Error(problem)
    }
  } else {
    throw new Error(`Unknown Git hook: ${event}`)
  }
}
