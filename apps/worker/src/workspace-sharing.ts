import { customizeWorkspace, inviteEditor, redeemInvite } from '@clausid/contracts'
import type { Workspace } from '@clausid/contracts'
import type { Account, Env } from './http.ts'
import { hex, HttpError, internal, readJson, sha256 } from './http.ts'

type Party = { id: string; email: string; redeemedDigest?: string }
type Invitation = { email: string; digest: string; expires: number }
type Sharing = { deleting?: boolean; workspace: Workspace; owner: Party; parties: Party[]; invites: Invitation[] }
const unavailable = () => new HttpError(404, 'Workspace unavailable.')

export async function workspaceSharing(ctx: DurableObjectState, env: Env, request: Request) {
  const { pathname } = new URL(request.url)
  const account: Account = JSON.parse(decodeURIComponent(request.headers.get('x-clausid-account')!))
  const state = await ctx.storage.get<Sharing>('workspace-sharing')
  const party = { id: account.id, email: account.email }

  if (pathname === '/sharing/initialize') {
    const workspace = await readJson(request) as Workspace
    await ctx.storage.transaction(async (tx) => {
      const existing = await tx.get<Sharing>('workspace-sharing')
      if (existing && (existing.owner.id !== account.id || existing.workspace.id !== workspace.id)) throw unavailable()
      if (!existing) await tx.put('workspace-sharing', { workspace, owner: party, parties: [], invites: [] } satisfies Sharing)
    })
    return new Response(null, { status: 204 })
  }
  if (!state) throw unavailable()

  if (pathname === '/sharing/delete') {
    if (state.owner.id !== account.id) throw unavailable()
    const conflict = () => new HttpError(409, 'Only empty, unshared workspaces can be deleted.')
    await ctx.storage.transaction(async (tx) => {
      const current = (await tx.get<Sharing>('workspace-sharing'))!
      if (current.parties.length || current.invites.length) throw conflict()
      await tx.put('workspace-sharing', { ...current, deleting: true })
    })
    const directory = env.DIRECTORY.get(env.DIRECTORY.idFromName(state.owner.id))
    const result = await directory.fetch('https://directory/workspace-delete/' + state.workspace.id, { method: 'POST' })
    if (result.status === 409) {
      await ctx.storage.transaction(async (tx) => {
        const current = (await tx.get<Sharing>('workspace-sharing'))!
        await tx.put('workspace-sharing', { ...current, deleting: false })
      })
      throw conflict()
    }
    if (!result.ok) throw new HttpError(503, 'Workspace directory is temporarily unavailable. Try again.')
    return new Response(null, { status: 204 })
  }

  if (pathname === '/sharing/redeem') {
    const { token } = redeemInvite.parse(await readJson(request))
    const digest = await sha256(new TextEncoder().encode(token))
    const matches = (invite: Invitation) => invite.digest === digest && invite.email === account.email && invite.expires > Date.now()
    await ctx.storage.transaction(async (tx) => {
      const current = (await tx.get<Sharing>('workspace-sharing'))!
      if (current.deleting) throw unavailable()
      if (current.parties.some(({ id, email, redeemedDigest }) =>
        id === account.id && email === account.email && redeemedDigest === digest)) return
      if (!current.invites.some(matches)) throw new HttpError(404, 'This workspace invitation is unavailable for your verified email.')
      if (current.parties.length >= 39) throw new HttpError(409, 'The workspace party limit has been reached.')
      await tx.put('workspace-sharing', {
        ...current, parties: [...current.parties, { ...party, redeemedDigest: digest }],
        invites: current.invites.filter((invite) => !matches(invite)),
      })
    })
    const memberWorkspace = { ...state.workspace, role: 'member' as const }
    const directory = env.DIRECTORY.get(env.DIRECTORY.idFromName(account.id))
    const result = await directory.fetch('https://directory/workspace-access', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(memberWorkspace),
    })
    if (!result.ok) throw new HttpError(503, 'Workspace directory is temporarily unavailable.')
    return Response.json(memberWorkspace)
  }

  const owner = state.owner.id === account.id
  if (!owner && !state.parties.some(({ id, email }) => id === account.id && email === account.email)) throw unavailable()
  if (pathname === '/sharing/details') {
    const workspace = state.workspace
    if (workspace.createdAt !== undefined) return Response.json({ ...workspace, assignee: workspace.assignee ?? state.owner })
    const directory = env.DIRECTORY.get(env.DIRECTORY.idFromName(state.owner.id))
    const source = await directory.fetch('https://directory/workspaces/' + workspace.id)
    if (!source.ok) return source
    const { createdAt } = await source.json<Workspace>()
    return Response.json({ ...workspace, createdAt, assignee: workspace.assignee ?? state.owner })
  }
  if (pathname === '/sharing/customize') {
    if (!owner) throw unavailable()
    const { name, description, project, status, assigneeId, label } = customizeWorkspace.parse(await readJson(request))
    const workspace = await ctx.storage.transaction(async (tx) => {
      const current = (await tx.get<Sharing>('workspace-sharing'))!
      if (current.deleting) throw unavailable()
      const assignee = assigneeId === undefined ? current.workspace.assignee ?? current.owner
        : [current.owner, ...current.parties].find(member => member.id === assigneeId)
      if (!assignee) throw new HttpError(422, 'Choose a verified workspace party.')
      const labels = current.workspace.labels ?? []
      const addLabel = label !== undefined && !labels.some(value => value.toLowerCase() === label.toLowerCase())
      if (addLabel && labels.length >= 20) throw new HttpError(422, 'A workspace can have up to 20 labels.')
      const workspace = { ...current.workspace,
        name: name ?? current.workspace.name, description: description ?? current.workspace.description,
        project: project === undefined ? current.workspace.project : project || null,
        status: status ?? current.workspace.status, updatedAt: Date.now(),
        assignee: { id: assignee.id, email: assignee.email },
        labels: addLabel ? [...labels, label] : labels }
      await tx.put('workspace-sharing', { ...current, workspace })
      return workspace
    })
    return Response.json({ ...workspace, role: 'owner' })
  }
  if (pathname === '/sharing/parties') {
    return Response.json({
      role: owner ? 'owner' : 'member', parties: [state.owner, ...state.parties].map(({ id, email }) => ({ id, email })),
      invitations: owner ? state.invites.filter(({ expires }) => expires > Date.now()).map(({ email }) => email) : [],
    })
  }
  if (pathname !== '/sharing/invite' || !owner) throw unavailable()

  const { email } = inviteEditor.parse(await readJson(request))
  const token = hex(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await sha256(new TextEncoder().encode(token))
  const invite = { email, digest, expires: Date.now() + 7 * 86_400_000 }
  await ctx.storage.transaction(async (tx) => {
    const current = (await tx.get<Sharing>('workspace-sharing'))!
    if (current.deleting) throw unavailable()
    if ([current.owner, ...current.parties].some((member) => member.email === email)) {
      throw new HttpError(409, 'This party already belongs to the workspace.')
    }
    const invites = current.invites.filter((item) => item.email !== email && item.expires > Date.now())
    if (current.parties.length + invites.length >= 39) throw new HttpError(409, 'The workspace party limit has been reached.')
    await tx.put('workspace-sharing', { ...current, invites: [...invites, invite] })
  })
  const sent = await internal(env, '/internal/invite', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, contractId: state.workspace.id, token, role: 'workspace' }),
  })
  if (!sent.ok) throw new HttpError(503, 'Email delivery is unavailable. Retry sending the workspace invitation.')
  return Response.json({ email }, { status: 201 })
}
