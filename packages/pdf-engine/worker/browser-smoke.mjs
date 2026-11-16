import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

const [input, output, base = 'http://127.0.0.1:8789'] = process.argv.slice(2)
if (!input || !output) throw new Error('Usage: browser-smoke.mjs INPUT_PDF OUTPUT_PDF [URL]')
const original = await readFile(input)

async function post(path, body, status = 200) {
  const response = await fetch(`${base}/v1/${path}`, { method: 'POST', body })
  if (response.status !== status) {
    assert.fail(`${path} returned ${response.status}: ${await response.text()}`)
  }
  return response
}

function frame(metadata) {
  const json = Buffer.from(JSON.stringify(metadata))
  const length = Buffer.alloc(4)
  length.writeUInt32LE(json.length)
  return Buffer.concat([length, json, original])
}

const { blocks, sourceDigest } = await (await post('inspect', original)).json()
assert.equal(sourceDigest, createHash('sha256').update(original).digest('hex'))
const target = blocks.find(block => block.text === '2. Payment is due within 15 days.')
assert.ok(target, 'Expected the second payment clause in the browser export')
const edit = { id: 'approved-clause', page: target.page, block: target.block, offset: 25, expected: '15', replacement: '30' }
await post('plan', frame({ sourceDigest, edit }))
const unavailable = { ...edit, replacement: 'Ω' }
assert.equal((await (await post('plan', frame({ sourceDigest, edit: unavailable }), 422)).json()).code, 'unsupported_pdf')
const result = Buffer.from(await (await post('apply', frame({ sourceDigest, edits: [edit] }))).arrayBuffer())
const reportLength = result.readUInt32LE()
const report = JSON.parse(result.subarray(4, 4 + reportLength).toString())
assert.deepEqual(report.applied, [edit.id])
const pdf = result.subarray(4 + reportLength)
assert.equal(report.digest, createHash('sha256').update(pdf).digest('hex'))
const { blocks: rewritten } = await (await post('inspect', pdf)).json()
assert.deepEqual(rewritten, blocks.map(block => block === target
  ? { ...block, text: '2. Payment is due within 30 days.' }
  : block))
await writeFile(output, pdf, { flag: 'wx' })
console.log('Browser contract round trip passed')
