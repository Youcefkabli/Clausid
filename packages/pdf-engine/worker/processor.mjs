import wasm from './pdf_engine_bg.wasm'
import { apply, initSync, inspect, plan } from './pdf_engine.js'

initSync({ module: wasm })

const maxPdfBytes = 16 * 1024 * 1024
const maxMetadataBytes = 128 * 1024
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8', { fatal: true })

class RequestError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function readRequest(request, limit) {
  const length = request.headers.get('content-length')
  if (length === null || !/^\d+$/.test(length)) {
    throw new RequestError(411, 'length_required', 'A content length is required.')
  }
  const size = Number(length)
  if (size > limit) {
    throw new RequestError(413, 'limit_exceeded', 'The PDF request is too large.')
  }
  if (!request.body) {
    throw new RequestError(400, 'invalid_body', 'The PDF request has no body.')
  }
  const bytes = new Uint8Array(size)
  const reader = request.body.getReader()
  let offset = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      if (value.length > size - offset) {
        await reader.cancel()
        throw new RequestError(400, 'invalid_body', 'The PDF request length does not match.')
      }
      bytes.set(value, offset)
      offset += value.length
    }
  } finally {
    reader.releaseLock()
  }
  if (offset !== size) {
    throw new RequestError(400, 'invalid_body', 'The PDF request length does not match.')
  }
  return bytes
}

function unpack(bytes) {
  if (bytes.length < 4) {
    throw new RequestError(400, 'invalid_body', 'Missing metadata length.')
  }
  const length = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true)
  if (length > Math.min(maxMetadataBytes, bytes.length - 4) || bytes.length - 4 - length > maxPdfBytes) {
    throw new RequestError(400, 'invalid_body', 'Invalid PDF or metadata length.')
  }
  try {
    return [textDecoder.decode(bytes.subarray(4, 4 + length)), bytes.subarray(4 + length)]
  } catch {
    throw new RequestError(400, 'invalid_metadata', 'Metadata must be UTF-8.')
  }
}

function responseWithPdf(report, bytes) {
  const metadata = textEncoder.encode(report)
  const prefix = new Uint8Array(4)
  new DataView(prefix.buffer).setUint32(0, metadata.length, true)
  return new Response(new Blob([prefix, metadata, bytes]), {
    headers: { 'content-type': 'application/octet-stream' },
  })
}

async function digest(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

let busy = false

export default {
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (request.method === 'GET' && path === '/healthz') {
      return new Response('ok')
    }
    if (request.method !== 'POST' || !['/v1/inspect', '/v1/plan', '/v1/apply'].includes(path)) {
      return new Response('Not found', { status: 404 })
    }
    if (busy) {
      return Response.json({ code: 'busy' }, { status: 503 })
    }
    busy = true
    try {
      if (path === '/v1/inspect') {
        const bytes = await readRequest(request, maxPdfBytes)
        return Response.json({ sourceDigest: await digest(bytes), blocks: JSON.parse(inspect(bytes)) })
      }
      const [metadata, bytes] = unpack(await readRequest(request, 4 + maxMetadataBytes + maxPdfBytes))
      let input
      try {
        input = JSON.parse(metadata)
      } catch {
        throw new RequestError(400, 'invalid_metadata', 'Expected JSON metadata.')
      }
      if (!input || typeof input !== 'object' || !/^[a-f0-9]{64}$/.test(input.sourceDigest)) {
        throw new RequestError(400, 'invalid_metadata', 'Expected a source digest.')
      }
      if (input.sourceDigest !== (await digest(bytes))) {
        throw new RequestError(409, 'source_mismatch', 'The PDF does not match the expected source.')
      }
      if (path === '/v1/plan') {
        plan(bytes, JSON.stringify(input.edit ?? null))
        return Response.json({ fits: true })
      }
      const result = apply(bytes, JSON.stringify(input.edits ?? null))
      try {
        const pdf = result.take_pdf()
        return responseWithPdf(
          JSON.stringify({
            sourceDigest: input.sourceDigest,
            digest: await digest(pdf),
            applied: JSON.parse(result.report()),
          }),
          pdf,
        )
      } finally {
        result.free()
      }
    } catch (error) {
      if (error instanceof RequestError) {
        return Response.json({ code: error.code, message: error.message }, { status: error.status })
      }
      if (typeof error === 'string') {
        try {
          const failure = JSON.parse(error)
          return Response.json(failure, { status: failure.code === 'invalid_metadata' ? 400 : 422 })
        } catch {
          // Unexpected engine error.
        }
      }
      return Response.json({ code: 'processor_error' }, { status: 500 })
    } finally {
      busy = false
    }
  },
}
