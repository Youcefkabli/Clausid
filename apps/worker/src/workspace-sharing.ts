import { requiredValue } from '../../../packages/contracts/src/invariant.ts'
import { workspaceSchema, customizeWorkspace, inviteEditor, redeemInvite } from '@clausid/contracts'
import type { Env } from './http.ts'
import { serviceResponse, artifact, hex, HttpError, internal, readJson, sha256 } from './http.ts'

import { accountFromRequest, cleanupPartyFromRequest, forgetContractSchema, initializeWorkspaceSchema, readSharing } from './records.ts'
import type { Sharing } from './records.ts'
type Invitation = Sharing['invites'][number]
const unavailable = () => new HttpError(404, 'Workspace unavailable.')

export async function deliverSetupInvitations(ctx: DurableObjectState, env: Env) {
  const state = await readSharing(ctx.storage)
  if (!state?.setupOutbox?.length || state.deleting) {
    return
  }
  await ctx.storage.setAlarm(Date.now() + 60_000)
  if (env.OPS_KEY) {
    return
  }
  const directory = env.DIRECTORY.get(env.DIRECTORY.idFromName(state.owner.id))
  if (!(await directory.fetch('https://directory/workspaces/' + state.workspace.id)).ok) {
    return
  }
  for (const mail of state.setupOutbox) {
    try {
      const digest = await sha256(new TextEncoder().encode(mail.token))
      const invite = state.invites.find((candidate) => candidate.email === mail.email && candidate.expires > Date.now() && candidate.digest === digest)
      const sent =
        !invite ||
        (
          await internal(env, '/internal/invite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...mail, contractId: state.workspace.id, role: 'workspace' }),
          })
        ).ok
      if (!sent) {
        continue
      }
      await ctx.storage.transaction(async (tx) => {
        const current = requiredValue(await readSharing(tx))
        await tx.put('workspace-sharing', {
          ...current,
          setupOutbox: current.setupOutbox?.filter((item) => item.token !== mail.token),
        })
      })
    } catch {
      console.error('Workspace setup invitation delivery failed')
    }
  }
}

export async function workspaceSharing(ctx: DurableObjectState, env: Env, request: Request) {
  const { pathname } = new URL(request.url)
  const account = pathname === '/sharing/forget-contract' ? cleanupPartyFromRequest(request) : accountFromRequest(request)
  const state = await readSharing(ctx.storage)
  const party = { id: account.id, email: account.email }

  if (pathname === '/sharing/initialize') {
    const body = initializeWorkspaceSchema.parse(await readJson(request, 32_768))
    const workspace = 'workspace' in body ? body.workspace : body
    const setup = 'workspace' in body ? { documentDigest: body.documentDigest } : undefined
    const setupOutbox = 'workspace' in body ? body.team.map((email) => ({ email, token: hex(crypto.getRandomValues(new Uint8Array(32))) })) : []
    const expires = Date.now() + 7 * 86_400_000
    const invites = await Promise.all(
      setupOutbox.map(async ({ email, token }) => ({
        email,
        expires,
        digest: await sha256(new TextEncoder().encode(token)),
      })),
    )
    await ctx.storage.transaction(async (tx) => {
      const existing = await readSharing(tx)
      if (existing && (existing.owner.id !== account.id || existing.workspace.id !== workspace.id)) {
        throw unavailable()
      }
      if (
        setup &&
        existing &&
        (existing.workspace.firstContractId !== workspace.firstContractId ||
          existing.workspace.documentName !== workspace.documentName ||
          (existing.setup && existing.setup.documentDigest !== setup.documentDigest))
      ) {
        throw new HttpError(409, 'Retry with the same setup document.')
      }
      if (!existing) {
        await tx.put('workspace-sharing', { workspace, owner: party, parties: [], invites, setup, setupOutbox } satisfies Sharing)
        if (setupOutbox.length) {
          await tx.setAlarm(Date.now() + 1000)
        }
      }
    })
    return new Response(null, { status: 204 })
  }
  if (!state) {
    throw unavailable()
  }

  if (pathname === '/sharing/setup-result') {
    if (state.owner.id !== account.id || state.deleting) {
      throw unavailable()
    }
    if (!state.setup && !state.workspace.firstContractId) {
      throw new HttpError(409, 'This request was already used for a different workspace setup.')
    }
    if (state.setupOutbox?.length) {
      await ctx.storage.setAlarm(Date.now() + 1000)
    }
    return Response.json(state.workspace, { status: 201 })
  }

  if (pathname === '/sharing/document') {
    if (state.owner.id !== account.id || state.deleting || !state.workspace.documentName) {
      throw unavailable()
    }
    const row = ctx.storage.sql.exec<{ data: ArrayBuffer }>("SELECT data FROM workspace_documents WHERE id = 'source'").toArray()[0]
    if (!row) {
      throw unavailable()
    }
    const response = artifact(new Uint8Array(row.data), 'application/pdf', 'workspace-document.pdf', true)
    response.headers.set(
      'Content-Disposition',
      "attachment; filename*=UTF-8''" +
        encodeURIComponent(new TextDecoder().decode(new TextEncoder().encode(state.workspace.documentName))).replace(
          /['()*]/g,
          (character) => '%' + character.charCodeAt(0).toString(16),
        ),
    )
    return response
  }

  if (pathname === '/sharing/delete') {
    if (state.owner.id !== account.id) {
      throw unavailable()
    }
    const conflict = () => new HttpError(409, 'Only empty, unshared workspaces can be deleted.')
    await ctx.storage.transaction(async (tx) => {
      const current = requiredValue(await readSharing(tx))
      if (current.parties.length || current.invites.length) {
        throw conflict()
      }
      await tx.put('workspace-sharing', { ...current, deleting: true })
    })
    const directory = env.DIRECTORY.get(env.DIRECTORY.idFromName(state.owner.id))
    const result = await directory.fetch('https://directory/workspace-delete/' + state.workspace.id, { method: 'POST' })
    if (result.status === 409) {
      await ctx.storage.transaction(async (tx) => {
        const current = requiredValue(await readSharing(tx))
        await tx.put('workspace-sharing', { ...current, deleting: false })
      })
      throw conflict()
    }
    if (!result.ok) {
      throw new HttpError(503, 'Workspace directory is temporarily unavailable. Try again.')
    }
    ctx.storage.sql.exec('DELETE FROM workspace_documents')
    return new Response(null, { status: 204 })
  }

  if (pathname === '/sharing/redeem') {
    const { token } = redeemInvite.parse(await readJson(request))
    const digest = await sha256(new TextEncoder().encode(token))
    const matches = (invite: Invitation) => invite.digest === digest && invite.email === account.email && invite.expires > Date.now()
    await ctx.storage.transaction(async (tx) => {
      const current = requiredValue(await readSharing(tx))
      if (current.deleting) {
        throw unavailable()
      }
      if (current.parties.some(({ id, email, redeemedDigest }) => id === account.id && email === account.email && redeemedDigest === digest)) {
        return
      }
      if (!current.invites.some(matches)) {
        throw new HttpError(404, 'This workspace invitation is unavailable for your verified email.')
      }
      if (current.parties.length >= 39) {
        throw new HttpError(409, 'The workspace party limit has been reached.')
      }
      await tx.put('workspace-sharing', {
        ...current,
        parties: [...current.parties, { ...party, redeemedDigest: digest }],
        invites: current.invites.filter((invite) => !matches(invite)),
      })
    })
    const memberWorkspace = { ...state.workspace, documentName: undefined, role: 'member' as const }
    const directory = env.DIRECTORY.get(env.DIRECTORY.idFromName(account.id))
    const result = await directory.fetch('https://directory/workspace-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(memberWorkspace),
    })
    if (!result.ok) {
      throw new HttpError(503, 'Workspace directory is temporarily unavailable.')
    }
    if (memberWorkspace.firstContractId) {
      const id = memberWorkspace.firstContractId
      const attached = await env.CONTRACTS.get(env.CONTRACTS.idFromName(id)).fetch('https://contract/join-workspace', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-clausid-contract': id,
          'x-clausid-account': encodeURIComponent(JSON.stringify(account)),
        },
        body: JSON.stringify({ workspaceId: state.workspace.id }),
      })
      if (attached.status === 404) {
        return Response.json({ ...memberWorkspace, firstContractId: null })
      }
      if (!attached.ok) {
        throw new HttpError(503, 'Contract access could not be prepared. Retry accepting the invitation.')
      }
    }
    return Response.json(memberWorkspace)
  }

  const owner = state.owner.id === account.id
  if (!owner && !state.parties.some(({ id, email }) => id === account.id && email === account.email)) {
    throw unavailable()
  }
  if (pathname === '/sharing/forget-contract') {
    if (!owner) {
      throw unavailable()
    }
    const { contractId } = forgetContractSchema.parse(await readJson(request))
    await ctx.storage.transaction(async (tx) => {
      const current = requiredValue(await readSharing(tx))
      if (current.workspace.firstContractId !== contractId) {
        return
      }
      await tx.put('workspace-sharing', {
        ...current,
        workspace: { ...current.workspace, firstContractId: null, documentName: null },
      })
    })
    return new Response(null, { status: 204 })
  }
  if (pathname === '/sharing/details') {
    const workspace = owner ? state.workspace : { ...state.workspace, documentName: undefined }
    if (workspace.createdAt !== undefined) {
      return Response.json({ ...workspace, assignee: workspace.assignee ?? state.owner })
    }
    const directory = env.DIRECTORY.get(env.DIRECTORY.idFromName(state.owner.id))
    const source = await directory.fetch('https://directory/workspaces/' + workspace.id)
    if (!source.ok) {
      return source
    }
    const { createdAt } = await serviceResponse(source, workspaceSchema)
    return Response.json({ ...workspace, createdAt, assignee: workspace.assignee ?? state.owner })
  }
  if (pathname === '/sharing/customize') {
    if (!owner) {
      throw unavailable()
    }
    const { name, description, project, status, assigneeId, label } = customizeWorkspace.parse(await readJson(request))
    const workspace = await ctx.storage.transaction(async (tx) => {
      const current = requiredValue(await readSharing(tx))
      if (current.deleting) {
        throw unavailable()
      }
      const assignee =
        assigneeId === undefined
          ? (current.workspace.assignee ?? current.owner)
          : [current.owner, ...current.parties].find((member) => member.id === assigneeId)
      if (!assignee) {
        throw new HttpError(422, 'Choose a verified workspace party.')
      }
      const labels = current.workspace.labels ?? []
      const addLabel = label !== undefined && !labels.some((value) => value.toLowerCase() === label.toLowerCase())
      if (addLabel && labels.length >= 20) {
        throw new HttpError(422, 'A workspace can have up to 20 labels.')
      }
      const workspace = {
        ...current.workspace,
        name: name ?? current.workspace.name,
        description: description ?? current.workspace.description,
        project: project === undefined ? current.workspace.project : project || null,
        status: status ?? current.workspace.status,
        updatedAt: Date.now(),
        assignee: { id: assignee.id, email: assignee.email },
        labels: addLabel ? [...labels, label] : labels,
      }
      await tx.put('workspace-sharing', { ...current, workspace })
      return workspace
    })
    return Response.json({ ...workspace, role: 'owner' })
  }
  if (pathname === '/sharing/parties') {
    return Response.json({
      role: owner ? 'owner' : 'member',
      parties: [state.owner, ...state.parties].map(({ id, email }) => ({ id, email })),
      invitations: owner ? state.invites.filter(({ expires }) => expires > Date.now()).map(({ email }) => email) : [],
    })
  }
  if (pathname !== '/sharing/invite' || !owner) {
    throw unavailable()
  }

  const { email } = inviteEditor.parse(await readJson(request))
  const token = hex(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await sha256(new TextEncoder().encode(token))
  const invite = { email, digest, expires: Date.now() + 7 * 86_400_000 }
  await ctx.storage.transaction(async (tx) => {
    const current = requiredValue(await readSharing(tx))
    if (current.deleting) {
      throw unavailable()
    }
    if ([current.owner, ...current.parties].some((member) => member.email === email)) {
      throw new HttpError(409, 'This party already belongs to the workspace.')
    }
    const invites = current.invites.filter((item) => item.email !== email && item.expires > Date.now())
    if (current.parties.length + invites.length >= 39) {
      throw new HttpError(409, 'The workspace party limit has been reached.')
    }
    await tx.put('workspace-sharing', { ...current, invites: [...invites, invite] })
  })
  const sent = await internal(env, '/internal/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, contractId: state.workspace.id, token, role: 'workspace' }),
  })
  if (!sent.ok) {
    throw new HttpError(503, 'Email delivery is unavailable. Retry sending the workspace invitation.')
  }
  return Response.json({ email }, { status: 201 })
}
