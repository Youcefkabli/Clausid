import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Step } from './plan.mts'

export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))

export type CommandOptions = { readonly env?: NodeJS.ProcessEnv; readonly onOutput?: (text: string) => void }

export async function runCommand(step: Step, root = repositoryRoot, timeout = 20 * 60_000, options: CommandOptions = {}): Promise<void> {
  const message = `\n[verify:${step.id}] ${step.command} ${step.args.join(' ')}\n`
  if (options.onOutput) {
    options.onOutput(message)
  } else {
    process.stdout.write(message)
  }
  await new Promise<void>((done, reject) => {
    const child = spawn(step.command, [...step.args], {
      cwd: resolve(root, step.cwd ?? '.'),
      env: options.env,
      stdio: options.onOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: false,
      detached: process.platform !== 'win32',
    })
    child.stdout?.on('data', (data) => options.onOutput?.(String(data)))
    child.stderr?.on('data', (data) => options.onOutput?.(String(data)))
    let timedOut = false
    let interrupted = false
    const terminate = (signal: NodeJS.Signals) => {
      if (child.pid === undefined) {
        return
      }
      try {
        if (process.platform === 'win32') {
          child.kill(signal)
        } else {
          process.kill(-child.pid, signal)
        }
      } catch {
        /* The command may have already exited. */
      }
    }
    const timer = setTimeout(() => {
      timedOut = true
      terminate('SIGTERM')
    }, timeout)
    const hardStop = setTimeout(() => terminate('SIGKILL'), timeout + 5_000)
    const interrupt = () => {
      interrupted = true
      terminate('SIGTERM')
    }
    process.once('SIGINT', interrupt)
    process.once('SIGTERM', interrupt)
    const cleanup = () => {
      clearTimeout(timer)
      clearTimeout(hardStop)
      process.off('SIGINT', interrupt)
      process.off('SIGTERM', interrupt)
    }
    child.once('error', (error) => {
      cleanup()
      reject(error)
    })
    child.once('close', (code, signal) => {
      cleanup()
      if (code === 0 && !timedOut && !interrupted && signal === null) {
        done()
      } else {
        reject(new Error(`${step.id} failed (${timedOut ? 'timeout' : interrupted ? 'interrupted' : (signal ?? `exit ${code}`)}).`))
      }
    })
  })
}
