import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import * as Y from 'yjs'
import type { ServerMessage } from '../packages/contracts/src/index.ts'
import { consentVersion } from '../packages/contracts/src/index.ts'
import { linkFor } from './mailpit.ts'

const origin = 'http://127.0.0.1:17887'

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const done = once(child, 'exit')
  child.kill('SIGTERM')
  await done
}

test('restoring both SQLite volumes preserves the draft, account, and signing evidence', async ({ playwright, browser }) => {
  await mkdir('.data', { recursive: true })
  const root = await mkdtemp(resolve('.data/persistence-'))
  let data = join(root, 'source')
  const directory = () => join(data, 'contracts')
  const env: NodeJS.ProcessEnv = {
    ...process.env, PUBLIC_ORIGIN: origin, AUTH_PORT: '17888', AUTH_HOST: '127.0.0.1',
    INTERNAL_AUTH_KEY: randomBytes(32).toString('hex'), BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    MAIL_FROM: 'Clausid test <mail@localhost.test>', SMTP_HOST: '127.0.0.1', SMTP_PORT: '1025',
  }
  const children: ChildProcess[] = []
  const context = await browser.newContext()
  const page = await context.newPage()
  const request = await playwright.request.newContext({ baseURL: origin, extraHTTPHeaders: {
    Origin: origin, 'X-Clausid-Client-IP': '127.0.0.1',
  } })
  const socket = async (id: string, edit?: { id: string; update: string }) => {
    const reply = await page.evaluate(({ id, edit }) => new Promise<string[]>((done, reject) => {
      const ws = new WebSocket(location.origin.replace('http:', 'ws:') + '/api/contracts/' + id + '/socket')
      ws.addEventListener('close', () => reject(new Error('The test WebSocket closed before it acknowledged the draft.')))
      ws.addEventListener('error', () => reject(new Error('The test WebSocket could not connect.')))
      const messages: string[] = []
      ws.onmessage = ({ data }) => {
        const message = JSON.parse(data)
        messages.push(data)
        if (message.type === 'state' && edit) {
          ws.send(JSON.stringify({ type: 'edit', ...edit }))
        } else if (message.type === 'state' || message.type === 'ack' || message.type === 'error') {
          done(messages)
          ws.close()
        }
      }
    }), { id, edit })
    return reply.map((item) => JSON.parse(item) as ServerMessage)
  }
  const startAuth = () => spawn(process.execPath, ['src/server.ts'], { cwd: 'apps/auth',
    env: { ...env, AUTH_DB_PATH: join(data, 'auth', 'auth.sqlite') }, stdio: 'inherit' })
  const startWorker = () => spawn('apps/worker/node_modules/workerd/bin/workerd', ['serve', 'deploy/workerd.capnp',
    '--socket-addr', 'http=127.0.0.1:17887', '--external-addr', 'auth=127.0.0.1:17888',
    '--directory-path', 'contractDisk=' + directory()], { env, stdio: 'inherit' })
  async function waitForServices() {
    await expect.poll(async () => {
      try {
        const result = await request.get('/api/auth/get-session')
        return result.status()
      } catch { return 0 }
    }, { timeout: 10_000 }).toBe(200)
  }
  try {
    await mkdir(directory(), { recursive: true })
    const migration = spawn(process.execPath, ['src/migrate.ts'], { cwd: 'apps/auth',
      env: { ...env, AUTH_DB_PATH: join(data, 'auth', 'auth.sqlite') }, stdio: 'inherit' })
    expect((await once(migration, 'exit'))[0]).toBe(0)
    let auth = startAuth()
    let worker = startWorker()
    children.push(auth, worker)
    await waitForServices()
    const email = 'restore-' + crypto.randomUUID().slice(0, 8) + '@example.com'
    const password = 'clausid-restoration-123'
    const signUp = await request.post('/api/auth/sign-up/email', { data: { name: 'Restore Tester', email, password, callbackURL: origin } })
    expect(signUp.status(), await signUp.text()).toBe(200)
    const verification = await request.get(await linkFor(email, 'verify'), { maxRedirects: 0 })
    expect(verification.status()).toBe(302)
    const login = await request.post('/api/auth/sign-in/email', { data: { email, password } })
    expect(login.status(), await login.text()).toBe(200)
    await context.addCookies((await request.storageState()).cookies)
    const makeDraft = async (title: string) => {
      const id = crypto.randomUUID()
      expect((await request.post('/api/contracts', { data: { title, requestId: id } })).status()).toBe(201)
      await page.goto(origin + '/healthz')
      const [initial] = await socket(id)
      if (initial.type !== 'state' || !initial.draft) throw new Error('No initial draft.')
      const draft = new Y.Doc()
      try {
        Y.applyUpdate(draft, Buffer.from(initial.draft, 'base64'))
        const before = Y.encodeStateVector(draft)
        const paragraph = draft.getXmlFragment('default').get(0) as Y.XmlElement
        const text = new Y.XmlText()
        paragraph.insert(0, [text])
        text.insert(0, 'The agreement remains intact.')
        const update = Buffer.from(Y.encodeStateAsUpdate(draft, before)).toString('base64')
        const [, ack] = await socket(id, { id: crypto.randomUUID(), update })
        expect(ack).toMatchObject({ type: 'ack', revision: 1 })
        return { id, path: '/api/contracts/' + id }
      } finally { draft.destroy() }
    }
    const prepare = async ({ path }: { path: string }) => {
      const preview = await request.post(path + '/preview', { data: { revision: 1, signers: [email] } })
      expect(preview.status(), await preview.text()).toBe(200)
      const { id: previewId, digest } = await preview.json()
      const freeze = await request.post(path + '/freeze', { data: { previewId } })
      expect(freeze.status(), await freeze.text()).toBe(200)
      return { versionId: previewId, digest, name: 'Restore Tester', consent: true, consentVersion }
    }

    const draft = await makeDraft('Restored draft')
    const signed = await makeDraft('Restored signed contract')
    const signature = await prepare(signed)
    expect((await request.post(signed.path + '/sign', { data: signature })).status()).toBe(200)
    const pdf = await (await request.get(signed.path + '/pdf')).body()

    const contested = await makeDraft('Signing and voiding race')
    const racing = await prepare(contested)
    const results = await Promise.all([
      request.post(contested.path + '/sign', { data: racing }),
      request.post(contested.path + '/void', { data: {} }),
    ])
    expect(results.filter((item) => item.ok())).toHaveLength(1)
    const resolved = await (await request.get(contested.path)).json()
    expect(['Signed', 'Voided']).toContain(resolved.status)
    if (resolved.status === 'Voided') {
      const copy = await request.post(contested.path + '/duplicate', { data: { title: 'Revised contract', requestId: crypto.randomUUID() } })
      expect(copy.status(), await copy.text()).toBe(201)
      expect((await copy.json()).status).toBe('Draft')
    }

    await Promise.all([stop(worker), stop(auth)])
    await expect(fetch(origin + '/healthz')).rejects.toThrow()
    data = join(root, 'restored')
    await cp(join(root, 'source'), data, { recursive: true })
    auth = startAuth()
    worker = startWorker()
    children.push(auth, worker)
    await waitForServices()
    await expect.poll(async () => (await request.get(draft.path)).status()).toBe(200)
    const [restoredDraft] = await socket(draft.id)
    expect(restoredDraft).toMatchObject({ type: 'state', contract: { revision: 1, status: 'Draft' } })
    if (restoredDraft.type !== 'state' || !restoredDraft.draft) throw new Error('Missing restored draft.')
    const restored = new Y.Doc()
    try {
      Y.applyUpdate(restored, Buffer.from(restoredDraft.draft, 'base64'))
      expect(restored.getXmlFragment('default').toString()).toContain('The agreement remains intact.')
    } finally { restored.destroy() }
    const restoredPdf = await request.get(signed.path + '/pdf')
    expect(restoredPdf.status()).toBe(200)
    expect((await restoredPdf.body()).equals(pdf)).toBe(true)
    expect((await request.get(signed.path + '/evidence')).status()).toBe(200)
  } finally {
    await context.close()
    await request.dispose()
    await Promise.all(children.map(stop))
    await rm(root, { recursive: true, force: true })
  }
})
