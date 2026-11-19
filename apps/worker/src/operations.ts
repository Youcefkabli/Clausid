import { requiredValue } from '../../../packages/contracts/src/invariant.ts'
import { recordStateSchema, restoreBookmarkSchema, sharingSchema, snapshotSchema, storedRecord } from './records.ts'
import { decode, encode, safeResponse, HttpError } from './http.ts'
import type { Env } from './http.ts'

const schemas = {
  directory: {
    contracts: ['id', 'created'],
    workspace_access: ['id', 'workspace'],
    workspaces: ['id', 'name', 'description', 'created'],
    workspace_slugs: ['id', 'slug'],
    workspace_contracts: ['id', 'workspace_id'],
    workspace_requests: ['request_id', 'workspace_id', 'ready'],
    workspace_projects: ['id', 'project'],
    workspace_documents: ['id', 'data'],
  },
  contract: { state: ['id', 'value'], files: ['id', 'data'], edits: ['id', 'revision'], review_requests: ['id', 'digest'] },
} as const

type Kind = keyof typeof schemas

export function authorizedOperation(request: Request, env: Env) {
  const key = env.OPS_KEY
  const provided = request.headers.get('Authorization') ?? ''
  if (!key || key.length < 32 || provided.length !== key.length + 7 || !provided.startsWith('Bearer ')) {
    return false
  }
  let difference = 0
  for (let i = 0; i < key.length; i++) {
    difference |= key.charCodeAt(i) ^ provided.charCodeAt(i + 7)
  }
  return difference === 0
}

export function snapshotObject(ctx: DurableObjectState, kind: Kind, request: Request) {
  return safeResponse(async () => {
    const path = new URL(request.url).pathname
    const { sql } = ctx.storage
    const schema: Record<string, readonly string[]> = schemas[kind]
    const tables = Object.entries(schema)
    if (path === '/ops/checkpoint' && request.method === 'GET') {
      for (const socket of ctx.getWebSockets()) {
        socket.close(1012, 'Maintenance')
      }
      return Response.json({ bookmark: await ctx.storage.getCurrentBookmark() })
    }
    if (path === '/ops/restart' && request.method === 'POST') {
      ctx.abort('Restart after storage recovery')
      return new Response(null, { status: 204 })
    }
    if (path === '/ops/restore' && request.method === 'POST') {
      const { bookmark } = restoreBookmarkSchema.parse(await request.json())
      if (!bookmark || !/^[\da-f-]+$/i.test(bookmark)) {
        throw new HttpError(400, 'Invalid bookmark.')
      }
      return Response.json({ undo: await ctx.storage.onNextSessionRestoreBookmark(bookmark) })
    }
    if (path !== '/ops/snapshot') {
      throw new HttpError(404, 'Operation unavailable.')
    }

    if (request.method === 'GET') {
      const applicationTables = sql
        .exec<{ name: string }>(`
        SELECT name FROM sqlite_schema WHERE type = 'table'
          AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '__cf_*' AND name NOT GLOB '_cf_*'
          AND name <> '__miniflare_do_name'
      `)
        .toArray()
      if (applicationTables.some(({ name }) => !Object.hasOwn(schemas[kind], name))) {
        throw new HttpError(409, 'Unrecognized object storage table.')
      }
      for (const socket of ctx.getWebSockets()) {
        socket.close(1012, 'Maintenance')
      }
      const kv = await ctx.storage.list({ limit: 2 })
      if ([...kv.keys()].some((key) => kind !== 'directory' || key !== 'workspace-sharing')) {
        throw new HttpError(409, 'Unrecognized object storage key.')
      }
      const sharing = kv.get('workspace-sharing')
      const rows = Object.fromEntries(
        tables.map(([name, columns]) => [
          name,
          [...sql.exec(`SELECT ${columns.join(', ')} FROM ${name} ORDER BY ${columns[0]}`).raw()].map((row) =>
            row.map((value) => (value instanceof ArrayBuffer ? encode(new Uint8Array(value)) : value)),
          ),
        ]),
      )
      return Response.json({ tables: rows, sharing })
    }

    if (request.method !== 'PUT') {
      throw new HttpError(405, 'Operation unavailable.')
    }
    const snapshot = snapshotSchema.parse(await request.json())
    if (kind === 'contract' && snapshot.tables && !Object.hasOwn(snapshot.tables, 'review_requests')) {
      snapshot['tables']['review_requests'] = []
    }
    if (kind === 'directory' && snapshot.tables) {
      for (const table of ['workspace_requests', 'workspace_projects', 'workspace_documents']) {
        if (!Object.hasOwn(snapshot.tables, table)) {
          snapshot.tables[table] = []
        }
      }
    }
    if (!snapshot.tables || Object.keys(snapshot.tables).length !== tables.length || (kind !== 'directory' && snapshot.sharing !== undefined)) {
      throw new HttpError(400, 'Invalid snapshot.')
    }
    if (!request.headers.has('content-type') || !request.headers.get('content-type')?.includes('application/json')) {
      throw new HttpError(415, 'Expected JSON snapshot.')
    }
    await ctx.storage.transaction(async (transaction) => {
      if (kind === 'directory' && (await transaction.get('workspace-sharing')) !== undefined) {
        throw new HttpError(409, 'Destination object contains data.')
      }
      for (const [name, columns] of tables) {
        if (sql.exec(`SELECT 1 FROM ${name} LIMIT 1`).toArray().length) {
          throw new HttpError(409, 'Destination object contains data.')
        }
        const rows = snapshot.tables[name]
        if (!Array.isArray(rows)) {
          throw new HttpError(400, 'Invalid snapshot.')
        }
        for (const row of rows) {
          if (!Array.isArray(row) || row.length !== columns.length || row.some((value) => typeof value !== 'string' && typeof value !== 'number')) {
            throw new HttpError(400, 'Invalid snapshot row.')
          }
          const values = name === 'files' || name === 'workspace_documents' ? [row[0], decode(String(row[1])).buffer] : row
          sql.exec(`INSERT INTO ${name} VALUES (${columns.map(() => '?').join(', ')})`, ...values)
        }
      }
      if (snapshot.sharing !== undefined) {
        await transaction.put('workspace-sharing', snapshot.sharing)
        if (sharingSchema.parse(snapshot.sharing).setupOutbox?.length) {
          await transaction.setAlarm(Date.now() + 60_000)
        }
      }
      if (
        kind === 'contract' &&
        requiredValue(snapshot.tables['state']).some(([, value]) => {
          const state = storedRecord(recordStateSchema, JSON.parse(String(value)))
          return state.outbox?.length || state.deletion?.accounts?.length
        })
      ) {
        await transaction.setAlarm(Date.now() + 60_000)
      }
    })
    return new Response(null, { status: 204 })
  })
}

export async function maintenanceRequest(request: Request, env: Env, exportOnly = false) {
  return safeResponse(async () => {
    if (!authorizedOperation(request, env)) {
      throw new HttpError(503, 'Clausid is in maintenance.')
    }
    const path = new URL(request.url).pathname
    const match = path.match(/^\/__clausid_ops\/(directory|contract)\/(physical|logical)\/([\w:-]+)\/(snapshot|checkpoint|restore|restart|identity)$/)
    if (!match) {
      throw new HttpError(404, 'Operation unavailable.')
    }
    const kind = requiredValue(match[1]),
      addressing = requiredValue(match[2]),
      id = requiredValue(match[3]),
      action = requiredValue(match[4])
    if ((exportOnly && (request.method !== 'GET' || !['snapshot', 'identity'].includes(action))) || (request.method === 'PUT' && addressing !== 'logical')) {
      throw new HttpError(405, 'Operation unavailable.')
    }
    const namespace = kind === 'directory' ? env.DIRECTORY : env.CONTRACTS
    const objectId = addressing === 'physical' ? namespace.idFromString(id) : namespace.idFromName(id)
    if (action === 'identity' && request.method === 'GET') {
      return Response.json({ id: objectId.toString() })
    }
    const response = await namespace.get(objectId).fetch('https://object/ops/' + action, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    })
    const headers = new Headers(response.headers)
    headers.set('Cache-Control', 'no-store')
    return new Response(response.body, { status: response.status, headers })
  })
}
