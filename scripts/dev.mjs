import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { loadEnvFile } from 'node:process'

if (existsSync('.env')) loadEnvFile('.env')
const storage = resolve(process.env.CLAUSID_DATA_DIR ?? '.data')
const env = {
  ...process.env,
  PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN ?? 'http://127.0.0.1:5173',
  AUTH_DB_PATH: resolve(storage, 'auth', 'auth.sqlite'),
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? randomBytes(32).toString('hex'),
  INTERNAL_AUTH_KEY: process.env.INTERNAL_AUTH_KEY ?? randomBytes(32).toString('hex'),
  MAIL_FROM: process.env.MAIL_FROM ?? 'Clausid <mail@localhost.test>',
}
mkdirSync(resolve(storage, 'contracts'), { recursive: true, mode: 0o700 })

for (const args of [['--filter', '@clausid/worker', 'build'], ['--filter', '@clausid/auth', 'migrate']]) {
  const result = spawnSync('pnpm', args, { env, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
const children = []
let closing = false
function stop(code) {
  if (closing) return
  closing = true
  process.exitCode = code
  for (const child of children) {
    try { process.kill(-child.pid, 'SIGTERM') } catch { /* Process already exited. */ }
  }
}
function start(command, args, options = {}) {
  const child = spawn(command, args, { env, stdio: 'inherit', detached: true, ...options })
  children.push(child)
  child.on('exit', (code) => { if (!closing) stop(code ?? 1) })
  child.on('error', (error) => { console.error(error.message); stop(1) })
}
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

start(process.execPath, ['src/server.ts'], { cwd: 'apps/auth' })
start('apps/worker/node_modules/workerd/bin/workerd', ['serve', 'deploy/workerd.capnp', '--external-addr',
  `auth=127.0.0.1:${env.AUTH_PORT ?? 8788}`, '--directory-path', 'contractDisk=' + resolve(storage, 'contracts')])
start('pnpm', ['--filter', '@clausid/web', 'dev'])
