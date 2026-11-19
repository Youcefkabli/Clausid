import { z } from 'zod'
// Exercise the installed Claude runner against a local response fixture: no paid model or real credentials.
import { once } from 'node:events'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git } from '../checks/git.mts'
import { repositoryRoot, runCommand } from '../checks/process.mts'

const root = mkdtempSync(join(tmpdir(), 'clausid-claude-hook-smoke-'))
let requests = 0
let toolPhase = false
let toolRequests = 0
const server = createServer((request, response) => {
  const chunks: Buffer[] = []
  let size = 0
  request.on('data', (chunk: Buffer) => {
    size += chunk.length
    if (size > 2 * 1024 * 1024) {
      response.writeHead(413).end()
      request.destroy()
    } else {
      chunks.push(Buffer.from(chunk))
    }
  })
  request.on('end', () => {
    if (response.writableEnded) {
      return
    }
    if (request.url?.includes('count_tokens')) {
      response.setHeader('Content-Type', 'application/json')
      response.end('{"input_tokens":1}')
      return
    }
    if (!request.url?.includes('/messages')) {
      response.writeHead(404).end()
      return
    }
    requests++
    const command =
      toolPhase && toolRequests++ < 2 ? (toolRequests === 1 ? 'git commit --no-verify -m forbidden-fixture' : 'printf tool-fixture-ok') : undefined
    const content = command
      ? { type: 'tool_use', id: `tool_fixture_${requests}`, name: 'Bash', input: { command } }
      : { type: 'text', text: 'Fixture response complete.' }
    const message = {
      id: `msg_fixture_${requests}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [content],
      stop_reason: command ? 'tool_use' : 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }
    let streaming = false
    try {
      const input: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      streaming = input !== null && typeof input === 'object' && Reflect.get(input, 'stream') === true
    } catch {
      /* Invalid requests receive a normal fixture response. */
    }
    if (!streaming) {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify(message))
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    const event = (type: string, data: object) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
    event('message_start', { message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } })
    event('content_block_start', {
      index: 0,
      content_block: command ? { type: 'tool_use', id: `tool_fixture_${requests}`, name: 'Bash', input: {} } : { type: 'text', text: '' },
    })
    event('content_block_delta', {
      index: 0,
      delta: command ? { type: 'input_json_delta', partial_json: JSON.stringify({ command }) } : { type: 'text_delta', text: 'Fixture response complete.' },
    })
    event('content_block_stop', { index: 0 })
    event('message_delta', { delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 1 } })
    event('message_stop', {})
    response.end()
  })
})

try {
  for (const directory of ['scripts/checks', 'scripts/agent', '.claude']) {
    cpSync(join(repositoryRoot, directory), join(root, directory), { recursive: true })
  }
  writeFileSync(join(root, '.gitignore'), '.data/\n')
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'clausid-hook-smoke', private: true, type: 'module', scripts: { 'check:changed': 'node fail.mjs' } }),
  )
  writeFileSync(join(root, 'fail.mjs'), 'console.error("Intentional smoke-check failure"); process.exitCode = 1\n')
  symlinkSync(join(repositoryRoot, 'node_modules'), join(root, 'node_modules'))
  git(['init', '-q'], root)
  mkdirSync(join(root, '.data'), { recursive: true })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Could not bind the Claude fixture server.')
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
    ANTHROPIC_API_KEY: 'clausid-local-fixture-only',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  }
  delete env['ANTHROPIC_AUTH_TOKEN']
  delete env['CLAUDE_CODE_OAUTH_TOKEN']
  let output = ''
  await runCommand(
    {
      id: 'claude-live-hooks',
      command: 'claude',
      args: [
        '--print',
        'Return a brief completion response. This is a local hook lifecycle fixture.',
        '--setting-sources',
        'project',
        '--no-session-persistence',
        '--tools',
        '',
        '--model',
        'claude-sonnet-4-6',
        '--max-budget-usd',
        '0.05',
      ],
    },
    root,
    90_000,
    {
      env,
      onOutput: (text) => {
        output = (output + text).slice(-16_000)
      },
    },
  )
  const directory = join(root, '.data/agent-hooks')
  const files = existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith('.json')) : []
  if (
    !files.some((file) => {
      const state: unknown = JSON.parse(readFileSync(join(directory, file), 'utf8'))
      return state !== null && typeof state === 'object' && Reflect.get(state, 'released') === true && Reflect.get(state, 'refusals') === 3
    })
  ) {
    throw new Error(`Claude did not execute the expected bounded completion loop.\n${output}`)
  }
  console.log(
    `Claude lifecycle smoke passed: ${requests} local response requests; real Stop hooks blocked three times, then reported unresolved checks. No paid provider was called.`,
  )

  // Only the disposable configuration is instrumented; each wrapper calls the real adapter.
  writeFileSync(join(root, 'pass.mjs'), 'process.exitCode=0\n')
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ private: true, type: 'module', scripts: { 'check:changed': 'node pass.mjs', 'check:policy': 'node pass.mjs', check: 'node pass.mjs' } }),
  )
  writeFileSync(
    join(root, 'toolSmoke.mts'),
    `
    import {writeFileSync} from 'node:fs';
    import {readInput} from './scripts/agent/input.mts';
    import {toolHook} from './scripts/agent/toolHooks.mts';
    const raw=readInput(); const input=JSON.parse(raw); const result=await toolHook(raw);
    writeFileSync('.data/'+input.hook_event_name+'-'+input.tool_use_id+'.json',JSON.stringify({result}));
    process.stdout.write(JSON.stringify(result)+'\\n');
  `,
  )
  const configurationSchema = z.object({
    hooks: z.record(
      z.string(),
      z.array(z.object({ matcher: z.string().optional(), hooks: z.array(z.object({ type: z.string(), command: z.string(), timeout: z.number() })) })),
    ),
  })
  const configured = configurationSchema.parse(JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8')))
  for (const event of ['PreToolUse', 'PostToolUse']) {
    const hooks = configured.hooks[event]
    if (!hooks?.[0]?.hooks[0]) {
      throw new Error('Missing configured tool hook.')
    }
    hooks[0].hooks[0].command = 'node "$(git rev-parse --show-toplevel)/toolSmoke.mts"'
  }
  writeFileSync(join(root, '.claude/settings.json'), JSON.stringify(configured))
  toolPhase = true
  output = ''
  await runCommand(
    {
      id: 'claude-live-tool-hooks',
      command: 'claude',
      args: [
        '--print',
        'Exercise the two local fixture tools, then finish.',
        '--setting-sources',
        'project',
        '--no-session-persistence',
        '--tools',
        'Bash',
        '--allowedTools',
        'Bash',
        '--model',
        'claude-sonnet-4-6',
        '--max-budget-usd',
        '0.05',
      ],
    },
    root,
    90_000,
    {
      env,
      onOutput: (text) => {
        output = (output + text).slice(-16_000)
      },
    },
  )
  const recordSchema = z.object({
    result: z.object({ hookSpecificOutput: z.object({ permissionDecision: z.string().optional(), additionalContext: z.string().optional() }).optional() }),
  })
  const records = readdirSync(join(root, '.data'))
    .filter((file) => /^(?:Pre|Post)ToolUse-/.test(file))
    .map((file) => recordSchema.parse(JSON.parse(readFileSync(join(root, '.data', file), 'utf8'))))
  if (
    !records.some((row) => row.result.hookSpecificOutput?.permissionDecision === 'deny') ||
    !records.some((row) => row.result.hookSpecificOutput?.additionalContext?.includes('passed'))
  ) {
    throw new Error(`Claude did not dispatch the expected real pre/post tool hooks.\n${output}`)
  }
  console.log('Claude tool lifecycle smoke passed: real PreToolUse denied the bypass and real PostToolUse ran shared checks after a harmless command.')
} finally {
  server.closeAllConnections()
  if (server.listening) {
    await new Promise<void>((done) => server.close(() => done()))
  }
  rmSync(root, { recursive: true, force: true })
}
