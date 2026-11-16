import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'

const base = process.argv[2] ?? 'http://127.0.0.1:8789'
const operations = deflateSync(Buffer.from('BT /F1 12 Tf 72 650 Td (Pay in 15 days) Tj ET\n'))
const second = Buffer.from('BT /F1 12 Tf 72 600 Td (Pay in 15 days) Tj ET\n')
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Count 1 /Kids [3 0 R] /Resources << /Font << /F1 4 0 R >> >> >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents [5 0 R 7 0 R] >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
  Buffer.concat([Buffer.from('<< /Filter /FlateDecode /Length 6 0 R >>\nstream\n'), operations, Buffer.from('\nendstream')]),
  String(operations.length),
  Buffer.concat([Buffer.from(`<< /Length ${second.length} >>\nstream\n`), second, Buffer.from('endstream')]),
]
const buffers = [Buffer.from('%PDF-1.4\n')]
const offsets = []
let size = buffers[0].length
for (const [index, object] of objects.entries()) {
  offsets.push(size)
  const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), Buffer.from(object), Buffer.from('\nendobj\n')])
  size += chunk.length
  buffers.push(chunk)
}
buffers.push(Buffer.from(`xref\n0 8\n0000000000 65535 f \n${offsets.map(offset =>
  `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Root 1 0 R /Size 8 >>\nstartxref\n${size}\n%%EOF\n`))
const source = Buffer.concat(buffers)

async function post(path, body, status = 200) {
  const response = await fetch(`${base}/v1/${path}`, { method: 'POST', body })
  assert.equal(response.status, status, await response.clone().text())
  return response
}

function frame(metadata, pdf = source) {
  const json = Buffer.from(JSON.stringify(metadata))
  const length = Buffer.alloc(4)
  length.writeUInt32LE(json.length)
  return Buffer.concat([length, json, pdf])
}

const inspected = await (await post('inspect', source)).json()
const sourceDigest = createHash('sha256').update(source).digest('hex')
assert.equal(inspected.sourceDigest, sourceDigest)
assert.deepEqual(inspected.blocks.map(block => block.text), ['Pay in 15 days', 'Pay in 15 days'])
assert.deepEqual(inspected.blocks[1].baseline, [72, 600])
const edit = { id: 'approved-revision', page: 0, block: 1, offset: 7, expected: '15', replacement: '30' }
assert.deepEqual(await (await post('plan', frame({ sourceDigest, edit }))).json(), { fits: true })
assert.equal((await (await post('plan', frame({ sourceDigest, edit: { ...edit, replacement: '100' } }), 422)).json()).code, 'unsupported_pdf')
assert.equal((await (await post('plan', frame({ sourceDigest: '0'.repeat(64), edit }), 409)).json()).code, 'source_mismatch')
const rewritten = Buffer.from(await (await post('apply', frame({ sourceDigest, edits: [edit] }))).arrayBuffer())
const metadataLength = rewritten.readUInt32LE()
const metadata = JSON.parse(rewritten.subarray(4, 4 + metadataLength).toString())
const pdf = rewritten.subarray(4 + metadataLength)
assert.deepEqual(metadata.applied, ['approved-revision'])
assert.equal(metadata.digest, createHash('sha256').update(pdf).digest('hex'))
const output = await (await post('inspect', pdf)).json()
assert.deepEqual(output.blocks.map(block => block.text), ['Pay in 15 days', 'Pay in 30 days'])
if (process.argv[3]) {
  const { writeFile } = await import('node:fs/promises')
  await writeFile(process.argv[3], pdf, { flag: 'wx' })
}
console.log('workerd PDF round trip passed')
