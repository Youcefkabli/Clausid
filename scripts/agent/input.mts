import { readSync } from 'node:fs'

export function readInput(limit = 128 * 1024): string {
  const chunks: Buffer[] = []
  const buffer = Buffer.alloc(8192)
  let size = 0
  while (size <= limit) {
    const count = readSync(0, buffer, 0, buffer.length, null)
    if (count === 0) {
      return Buffer.concat(chunks).toString('utf8')
    }
    size += count
    if (size > limit) {
      break
    }
    chunks.push(Buffer.from(buffer.subarray(0, count)))
  }
  throw new Error('Hook input exceeds its size limit.')
}
