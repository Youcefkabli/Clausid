import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { repositoryRoot, runCommand } from './process.mts'

// Each smoke run owns a temporary loopback port instead of the dev server's fixed port.
const reservation = createServer()
reservation.listen(0, '127.0.0.1')
await once(reservation, 'listening')
const address = reservation.address()
if (!address || typeof address === 'string') {
  throw new Error('Could not reserve a PDF smoke port.')
}
const port = address.port
await new Promise<void>((done, reject) => reservation.close((error) => (error ? reject(error) : done())))
const origin = `http://127.0.0.1:${port}`
const child = spawn('apps/worker/node_modules/workerd/bin/workerd', ['serve', 'deploy/pdf-workerd.capnp', '--socket-addr', `http=127.0.0.1:${port}`], {
  cwd: repositoryRoot,
  stdio: 'inherit',
})
let failure: Error | undefined
child.on('error', (error) => {
  failure = error
})
const exit = new Promise<void>((done) => child.once('close', () => done()))
let interrupted = false
const interrupt = () => {
  interrupted = true
  child.kill('SIGTERM')
}
process.once('SIGINT', interrupt)
process.once('SIGTERM', interrupt)
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (failure) {
      throw failure
    }
    if (interrupted || child.exitCode !== null || child.signalCode !== null) {
      throw new Error('PDF smoke server stopped before readiness.')
    }
    try {
      ready = (await fetch(origin + '/healthz', { signal: AbortSignal.timeout(250) })).ok
    } catch {
      /* Startup is retried within the bound. */
    }
    if (ready) {
      break
    }
    await delay(250)
  }
  if (!ready) {
    throw new Error('PDF smoke server did not become healthy within the startup budget.')
  }
  await runCommand({ id: 'pdf-roundtrip', command: process.execPath, args: ['packages/pdf-engine/worker/smoke.mjs', origin] })
  if (failure || interrupted || child.exitCode !== null || child.signalCode !== null) {
    throw failure ?? new Error('PDF smoke server stopped during the test.')
  }
} finally {
  process.off('SIGINT', interrupt)
  process.off('SIGTERM', interrupt)
  child.kill('SIGTERM')
  const hardStop = setTimeout(() => child.kill('SIGKILL'), 3_000)
  await exit
  clearTimeout(hardStop)
}
