import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const namespaces = { contract: 'clausid-contract-db-v1', directory: 'clausid-directory-db-v1' }
const authTables = ['user', 'account', 'session', 'verification', 'rateLimit']
const hash = (value) => createHash('sha256').update(value).digest('hex')
const safeId = /^[\w:-]+$/
const [command, root, output] = process.argv.slice(2)

function endpoint() {
  const url = new URL(process.env.CLAUSID_OPS_ORIGIN ?? 'http://127.0.0.1:17897')
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) || url.username || url.password) {
    throw new Error('Operations require HTTPS or a loopback origin.')
  }
  const key = process.env.CLAUSID_OPS_KEY
  if (!key || key.length < 32) {
    throw new Error('Set CLAUSID_OPS_KEY to the temporary operator secret.')
  }
  return async (kind, addressing, id, action, body) => {
    if (!Object.hasOwn(namespaces, kind) || !safeId.test(id)) {
      throw new Error('Invalid object identity.')
    }
    const response = await fetch(new URL(`/__clausid_ops/${kind}/${addressing}/${id}/${action}`, url), {
      method: body === undefined ? 'GET' : action === 'snapshot' ? 'PUT' : 'POST',
      redirect: 'error',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (action === 'restart' && response.status === 500) {
      return
    }
    if (!response.ok) {
      throw new Error(`Object operation failed with status ${response.status}.`)
    }
    return response.status === 204 ? undefined : response.json()
  }
}

function readAuth(path) {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const actualTables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()
    if (actualTables.some(({ name }) => !authTables.includes(name))) {
      throw new Error('Unrecognized auth table.')
    }
    return Object.fromEntries(authTables.map((table) => [table, db.prepare(`SELECT * FROM "${table}" ORDER BY id`).all()]))
  } finally {
    db.close()
  }
}

const sqlIdentifier = (value) => '"' + value.replaceAll('"', '""') + '"'
function sqlValue(value) {
  if (value === null) {
    return 'NULL'
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return String(value)
  }
  if (typeof value === 'string') {
    return `CAST(X'${Buffer.from(value).toString('hex')}' AS TEXT)`
  }
  throw new Error('Unsupported auth storage value.')
}

function authSql(auth) {
  return (
    authTables
      .flatMap((table) =>
        auth[table].map((record) => {
          const columns = Object.keys(record).map(sqlIdentifier).join(', ')
          return `INSERT INTO ${sqlIdentifier(table)} (${columns}) VALUES (${Object.values(record).map(sqlValue).join(', ')});`
        }),
      )
      .join('\n') + '\n'
  )
}

async function auditWorkspaceOwners(records, call) {
  const owners = new Map()
  for (const { physical, snapshot } of records) {
    for (const [id] of snapshot.tables.workspaces) {
      if (owners.has(id)) {
        throw new Error(`Duplicate workspace ownership for ${id}.`)
      }
      owners.set(id, physical)
    }
  }
  for (const {
    physical,
    snapshot: { sharing },
  } of records) {
    if (!sharing) {
      continue
    }
    const id = sharing.workspace.id
    const [workspaceObject, ownerObject] = await Promise.all([
      call('directory', 'logical', 'workspace:' + id, 'identity'),
      call('directory', 'logical', sharing.owner.id, 'identity'),
    ])
    if (physical !== workspaceObject.id || owners.get(id) !== ownerObject.id) {
      throw new Error(`Workspace sharing owner mismatch for ${id}.`)
    }
  }
  return owners.size
}

async function exportSource(auditOnly = false) {
  const call = endpoint()
  const auth = auditOnly ? { user: [] } : readAuth(join(root, 'auth', 'auth.sqlite'))
  const directories = new Set(auth.user.map(({ id }) => id))
  const contracts = new Set()
  const references = new Set()
  const stored = []
  for (const [kind, namespace] of Object.entries(namespaces)) {
    if (auditOnly && kind !== 'directory') {
      continue
    }
    const path = join(root, 'contracts', namespace)
    const files = await readdir(path).catch((error) => {
      if (error.code === 'ENOENT') {
        return []
      }
      throw error
    })
    for (const file of files.sort()) {
      if (file === 'metadata.sqlite' || /\.sqlite-(shm|wal|journal)$/.test(file)) {
        continue
      }
      const match = /^([a-f0-9]{64})\.sqlite$/.exec(file)
      if (!match) {
        throw new Error('Unrecognized workerd storage file.')
      }
      const [, physical] = match
      const snapshot = await call(kind, 'physical', physical, 'snapshot')
      if (!snapshot.sharing && Object.values(snapshot.tables).every((rows) => !rows.length)) {
        continue
      }
      stored.push({ kind, physical, snapshot })
      if (kind === 'directory') {
        const { sharing, tables } = snapshot
        for (const [id] of [...tables.workspaces, ...tables.workspace_access]) {
          directories.add('workspace:' + id)
        }
        for (const [id] of tables.contracts) {
          references.add(id)
        }
        if (sharing) {
          directories.add('workspace:' + sharing.workspace.id)
          for (const party of [sharing.owner, ...sharing.parties]) {
            directories.add(party.id)
          }
        }
      } else {
        const state = JSON.parse(snapshot.tables.state.find(([id]) => id === 'contract')?.[1] ?? 'null')
        if (!state) {
          throw new Error('Stored contract lacks its metadata.')
        }
        contracts.add(state.id)
        for (const member of [state.owner, ...state.editors, ...state.signers]) {
          directories.add(member.id)
        }
      }
    }
  }

  const count = await auditWorkspaceOwners(
    stored.filter(({ kind }) => kind === 'directory'),
    call,
  )
  if (auditOnly) {
    console.log(`Verified ownership for ${count} workspaces.`)
    return
  }

  const identities = new Map()
  for (const [kind, names] of Object.entries({ directory: directories, contract: contracts })) {
    for (const name of names) {
      const { id } = await call(kind, 'logical', name, 'identity')
      identities.set(kind + ':' + id, name)
    }
  }
  const objects = stored.map(({ kind, physical, snapshot }) => {
    const name = identities.get(kind + ':' + physical)
    if (!name) {
      throw new Error('Export contains an unclassified populated object.')
    }
    return { kind, name, snapshot, sha256: hash(JSON.stringify(snapshot)) }
  })
  const sql = authSql(auth)
  const manifest = {
    version: 1,
    auth: { counts: Object.fromEntries(authTables.map((name) => [name, auth[name].length])), sha256: hash(sql) },
    danglingContracts: [...references].filter((id) => !contracts.has(id)).length,
    objects,
  }
  await mkdir(output, { mode: 0o700 })
  await writeFile(join(output, 'objects.json'), JSON.stringify(manifest), { mode: 0o600, flag: 'wx' })
  await writeFile(join(output, 'auth.sql'), sql, { mode: 0o600, flag: 'wx' })
  console.log(`Exported ${objects.length} objects. Dangling contract references: ${manifest.danglingContracts}.`)
}

async function loadExport() {
  const manifest = JSON.parse(await readFile(join(root, 'objects.json'), 'utf8'))
  if (manifest.version !== 1 || !Array.isArray(manifest.objects) || hash(await readFile(join(root, 'auth.sql'))) !== manifest.auth.sha256) {
    throw new Error('Invalid export manifest.')
  }
  const seen = new Set()
  for (const { kind, name, snapshot, sha256 } of manifest.objects) {
    const key = kind + ':' + name
    if (!Object.hasOwn(namespaces, kind) || !safeId.test(name) || seen.has(key) || hash(JSON.stringify(snapshot)) !== sha256) {
      throw new Error('Invalid object snapshot.')
    }
    seen.add(key)
    for (const [table, rows] of Object.entries(snapshot.tables)) {
      for (const row of rows) {
        const rowBytes = table === 'files' ? Buffer.from(row[1], 'base64').length + Buffer.byteLength(row[0]) : Buffer.byteLength(JSON.stringify(row))
        if (rowBytes >= 8_000_000) {
          throw new Error('Snapshot row exceeds the migration size limit.')
        }
      }
    }
    if (kind === 'contract') {
      const state = JSON.parse(snapshot.tables.state.find(([id]) => id === 'contract')?.[1] ?? 'null')
      const frozen = snapshot.tables.files.find(([id]) => id === 'frozen')?.[1]
      if (state?.id !== name || (state.version && (!frozen || hash(Buffer.from(frozen, 'base64')) !== state.version.digest))) {
        throw new Error('Contract identity or frozen PDF failed preflight.')
      }
    }
    if (Buffer.byteLength(JSON.stringify(snapshot.sharing ?? null)) >= 8_000_000 || Buffer.byteLength(JSON.stringify(snapshot)) >= 95_000_000) {
      throw new Error('Object snapshot exceeds the migration size limit.')
    }
  }
  return manifest
}

function matchesSnapshot(kind, snapshot, expectedHash) {
  if (hash(JSON.stringify(snapshot)) === expectedHash) {
    return true
  }
  if (kind !== 'directory') {
    return false
  }
  // Older snapshots can omit tables introduced after the export.
  const tables = { ...snapshot.tables }
  for (const table of ['workspace_documents', 'workspace_projects', 'workspace_requests']) {
    if (tables[table]?.length !== 0) {
      break
    }
    delete tables[table]
    if (hash(JSON.stringify({ ...snapshot, tables })) === expectedHash) {
      return true
    }
  }
  return false
}

async function transferObjects(upload) {
  const { objects } = await loadExport()
  const call = endpoint()
  for (const { kind, name, snapshot, sha256 } of objects) {
    if (upload) {
      await call(kind, 'logical', name, 'snapshot', snapshot)
    }
    const actual = await call(kind, 'logical', name, 'snapshot')
    if (!matchesSnapshot(kind, actual, sha256)) {
      throw new Error('Destination object verification failed.')
    }
  }
  console.log(`Verified ${objects.length} destination objects.`)
}

async function cloudInventory(config) {
  const token = process.env.CLAUSID_CLOUDFLARE_READ_TOKEN
  if (!token || !/^[a-f0-9]{32}$/i.test(config.accountId)) {
    throw new Error('Cloudflare inventory credentials are required.')
  }
  const objects = []
  for (const kind of Object.keys(namespaces)) {
    const namespace = config[kind]
    if (!/^[a-f0-9]{32}$/i.test(namespace)) {
      throw new Error('Invalid Cloudflare namespace ID.')
    }
    const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/workers/durable_objects/namespaces/${namespace}/objects`)
    let cursor
    do {
      if (cursor) {
        url.searchParams.set('cursor', cursor)
      }
      const response = await fetch(url, { redirect: 'error', headers: { Authorization: 'Bearer ' + token } })
      if (!response.ok) {
        throw new Error(`Cloudflare inventory failed with status ${response.status}.`)
      }
      const listing = await response.json()
      if (!listing.success || !Array.isArray(listing.result)) {
        throw new Error('Invalid Cloudflare inventory.')
      }
      for (const object of listing.result) {
        if (object.hasStoredData !== false) {
          if (!/^[a-f0-9]{64}$/.test(object.id)) {
            throw new Error('Invalid Cloudflare object ID.')
          }
          objects.push({ kind, id: object.id })
        }
      }
      cursor = listing.result_info?.cursors?.after
    } while (cursor)
  }
  return objects.sort((left, right) => (left.kind + left.id).localeCompare(right.kind + right.id))
}

async function auditCloudWorkspaces() {
  const config = JSON.parse(await readFile(root, 'utf8'))
  const call = endpoint()
  const records = []
  for (const { kind, id } of await cloudInventory(config)) {
    if (kind !== 'directory') {
      continue
    }
    records.push({ physical: id, snapshot: await call(kind, 'physical', id, 'snapshot') })
  }
  const count = await auditWorkspaceOwners(records, call)
  console.log(`Verified ownership for ${count} workspaces.`)
}

async function checkpoint() {
  const config = JSON.parse(await readFile(root, 'utf8'))
  if (!config.release || !config.d1Bookmark) {
    throw new Error('The checkpoint requires a release and D1 bookmark.')
  }
  const call = endpoint()
  const objects = []
  for (const { kind, id } of await cloudInventory(config)) {
    const { bookmark } = await call(kind, 'physical', id, 'checkpoint')
    const snapshot = await call(kind, 'physical', id, 'snapshot')
    objects.push({ kind, id, bookmark, sha256: hash(JSON.stringify(snapshot)) })
  }
  await writeFile(output, JSON.stringify({ version: 1, config, objects }), { mode: 0o600, flag: 'wx' })
  console.log(`Recorded ${objects.length} Durable Object checkpoints.`)
}

async function recover(action) {
  const saved = JSON.parse(await readFile(root, 'utf8'))
  if (saved.version !== 1 || !Array.isArray(saved.objects)) {
    throw new Error('Invalid checkpoint manifest.')
  }
  const inventory = await cloudInventory(saved.config)
  const expected = saved.objects.map(({ kind, id }) => ({ kind, id }))
  if (JSON.stringify(inventory) !== JSON.stringify(expected)) {
    throw new Error('Stored object inventory differs from the checkpoint. Resolve inventory differences before recovery.')
  }
  if (action === 'check-inventory') {
    console.log(`Verified ${inventory.length} checkpoint inventory entries.`)
    return
  }
  const call = endpoint()
  for (const { kind, id, bookmark, sha256 } of saved.objects) {
    if (action === 'recover') {
      await call(kind, 'physical', id, 'restore', { bookmark })
      await call(kind, 'physical', id, 'restart', {})
    }
    const snapshot = await call(kind, 'physical', id, 'snapshot')
    if (!matchesSnapshot(kind, snapshot, sha256)) {
      throw new Error('Checkpoint data verification failed.')
    }
  }
  console.log(`Verified ${saved.objects.length} checkpoint objects.`)
}

try {
  if (command === 'export' && root && output) {
    await exportSource()
  } else if (command === 'audit-workspaces' && root && !output) {
    await exportSource(true)
  } else if (command === 'audit-cloud-workspaces' && root && !output) {
    await auditCloudWorkspaces()
  } else if (command === 'preflight' && root && !output) {
    const { objects } = await loadExport()
    console.log(`Preflight passed for ${objects.length} objects.`)
  } else if (['import-objects', 'verify'].includes(command) && root && !output) {
    await transferObjects(command === 'import-objects')
  } else if (command === 'checkpoint' && root && output) {
    await checkpoint()
  } else if (['recover', 'verify-checkpoint', 'check-inventory'].includes(command) && root && !output) {
    await recover(command)
  } else {
    throw new Error(
      'Usage: node scripts/transfer.mjs export <copied-data-dir> <new-export-dir> | audit-workspaces <copied-data-dir> | audit-cloud-workspaces <config> | preflight|import-objects|verify <export-dir> | checkpoint <config> <output> | recover|verify-checkpoint|check-inventory <checkpoint>',
    )
  }
} catch (error) {
  console.error('Transfer failed:', error.message)
  process.exitCode = 1
}
