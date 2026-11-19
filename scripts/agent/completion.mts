import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { cleanGitEnvironment, git, hasCommit } from '../checks/git.mts'
import { repositoryRoot, runCommand } from '../checks/process.mts'

export type Harness = 'codex' | 'claude'
export type HookOutput = { readonly decision?: 'block'; readonly reason?: string; readonly systemMessage?: string }
export type SessionState = {
  readonly base?: string | undefined
  readonly digest?: string | undefined
  readonly refusals: number
  readonly chain: number
  readonly released: boolean
}
const empty: SessionState = { refusals: 0, chain: 0, released: false }
const reportLimit = 12_000

function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object' ? Reflect.get(value, key) : undefined
}

export function parseEvent(raw: string, event: 'start' | 'stop') {
  const data: unknown = JSON.parse(raw)
  const session = field(data, 'session_id')
  const cwd = field(data, 'cwd')
  const active = field(data, 'stop_hook_active')
  if (
    typeof session !== 'string' ||
    !session.length ||
    session.length > 256 ||
    typeof cwd !== 'string' ||
    !cwd.length ||
    cwd.length > 4096 ||
    field(data, 'hook_event_name') !== (event === 'start' ? 'SessionStart' : 'Stop') ||
    (event === 'stop' && typeof active !== 'boolean')
  ) {
    throw new Error('Invalid completion-hook payload; expected session_id, cwd, event and stop_hook_active.')
  }
  return { session, cwd, active: active === true }
}

function sessionFile(root: string, harness: Harness, session: string): string {
  const directory = join(root, '.data', 'agent-hooks')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const local = relative(realpathSync(root), realpathSync(directory))
  if (local === '..' || local.startsWith('../')) {
    throw new Error('Agent hook state must stay inside the worktree.')
  }
  return join(
    directory,
    createHash('sha256')
      .update(harness + ':' + session)
      .digest('hex') + '.json',
  )
}

function readState(file: string): SessionState {
  if (!existsSync(file)) {
    return empty
  }
  if (statSync(file).size > 4096) {
    throw new Error('Completion state exceeds its size limit.')
  }
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
  const base = field(value, 'base')
  const digest = field(value, 'digest')
  const refusals = field(value, 'refusals')
  const chain = field(value, 'chain')
  const released = field(value, 'released')
  if (
    (base !== undefined && (typeof base !== 'string' || !/^[a-f\d]{40,64}$/.test(base))) ||
    (digest !== undefined && (typeof digest !== 'string' || !/^[a-f\d]{64}$/.test(digest))) ||
    typeof refusals !== 'number' ||
    !Number.isInteger(refusals) ||
    refusals < 0 ||
    refusals > 3 ||
    typeof chain !== 'number' ||
    !Number.isInteger(chain) ||
    chain < 0 ||
    chain > 6 ||
    typeof released !== 'boolean'
  ) {
    throw new Error('Invalid completion state; inspect .data/agent-hooks before retrying.')
  }
  return { base, digest, refusals, chain, released }
}

function saveState(file: string, state: SessionState) {
  const temporary = file + '.' + randomUUID() + '.tmp'
  writeFileSync(temporary, JSON.stringify(state), { mode: 0o600, flag: 'wx' })
  renameSync(temporary, file)
}

export function decideFailure(previous: SessionState, digest: string, active: boolean) {
  const same = previous.digest === digest
  const refusals = same ? previous.refusals : 0
  const chain = active ? previous.chain : 0
  const release = (same && previous.released) || refusals >= 3 || chain >= 6
  const state: SessionState = {
    base: previous.base,
    digest,
    refusals: release ? refusals : refusals + 1,
    chain: release ? chain : chain + 1,
    released: release,
  }
  return { state, release }
}

export function findingDigest(report: string): string {
  // Durations/timestamps change on every run and must not reset identical-finding retries.
  const stable = stripVTControlCharacters(report)
    .replace(/\(node:\d+\)/g, '(node:<pid>)')
    .split('\n')
    .filter((line) => !/^\s*(Start at|Duration|Finished |\d\d:\d\d:\d\d)/.test(line))
    .map((line) => line.replace(/\b\d+(?:\.\d+)?(?:ms|s)\b/g, '<duration>'))
    .join('\n')
  return createHash('sha256').update(stable).digest('hex')
}

export async function completion(harness: Harness, event: 'start' | 'stop', raw: string, scriptRoot = repositoryRoot): Promise<HookOutput> {
  const payload = parseEvent(raw, event)
  const env = cleanGitEnvironment(scriptRoot)
  const root = git(['rev-parse', '--show-toplevel'], payload.cwd, { env }).trim()
  const common = (cwd: string) => realpathSync(git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd, { env }).trim())
  if (common(root) !== common(scriptRoot)) {
    throw new Error('Completion hook cwd belongs to another repository.')
  }
  const file = sessionFile(root, harness, payload.session)
  let previous = readState(file)
  if (event === 'start') {
    if (!previous.base && hasCommit(root)) {
      previous = { ...previous, base: git(['rev-parse', 'HEAD'], root, { env }).trim() }
    }
    saveState(file, previous)
    return {}
  }
  let output = ''
  try {
    await runCommand(
      { id: 'agent-completion', command: 'pnpm', args: ['check:changed', '--agent', ...(previous.base ? ['--base', previous.base] : [])] },
      root,
      8 * 60_000,
      {
        env,
        onOutput: (text) => {
          output = (output + text).slice(-reportLimit)
        },
      },
    )
    saveState(file, { base: previous.base, refusals: 0, chain: 0, released: false })
    return { systemMessage: 'Clausid completion checks passed. Required full integration profiles still run before pushing.' }
  } catch (error) {
    const report = `${output}\n${error instanceof Error ? error.message : String(error)}`.slice(-reportLimit)
    const result = decideFailure(previous, findingDigest(report), payload.active)
    saveState(file, result.state)
    if (result.release) {
      return {
        systemMessage: `Clausid verification is STILL FAILING. Completion retries are exhausted; report the unresolved checks to the user. This is not a passing result.\n${report}`,
      }
    }
    return {
      decision: 'block',
      reason: `Clausid checks failed (attempt ${result.state.refusals}/3 for these findings). Fix findings within the authorized task scope and retry; report unrelated/environment blockers instead of changing them. Do not bypass the gate.\n${report}`,
    }
  }
}
