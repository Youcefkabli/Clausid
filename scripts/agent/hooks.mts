import { completion } from './completion.mts'
import { readInput } from './input.mts'

async function main() {
  const [harness, event] = process.argv.slice(2)
  if ((harness !== 'codex' && harness !== 'claude') || (event !== 'start' && event !== 'stop')) {
    throw new Error('Expected codex|claude start|stop.')
  }
  const result = await completion(harness, event, readInput())
  // Stop stdout is always one JSON object: subprocess output is captured, never mixed with it.
  process.stdout.write(JSON.stringify(result) + '\n')
}

main().catch((error) => {
  const message = `Clausid hook could not verify completion: ${error instanceof Error ? error.message : String(error)}. Report this hook failure; do not claim checks passed.`
  // A protocol/state failure needs human attention, not an unbounded automatic retry.
  process.stdout.write(JSON.stringify({ continue: false, stopReason: message, systemMessage: message }) + '\n')
})
