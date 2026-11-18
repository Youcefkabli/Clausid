import type { createAuth } from './policy.ts'

export async function sessionResponse(auth: ReturnType<typeof createAuth>, headers: Headers) {
  const session = await auth.api.getSession({ headers })
  if (!session?.user.emailVerified) return new Response(null, { status: 401 })
  return Response.json({
    id: session.user.id, email: session.user.email.toLowerCase(), name: session.user.name,
    createdAt: session.session.createdAt.getTime(), expires: session.session.expiresAt.getTime(),
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function sendInvitation(
  origin: string,
  sendMail: (to: string, subject: string, text: string) => Promise<void>,
  { email, contractId, token, role }: { email: string; contractId: string; token: string; role: string },
) {
  const url = new URL(`/${role === 'workspace' ? 'workspace-invite' : 'invite'}/${contractId}`, origin)
  url.hash = new URLSearchParams({ token }).toString()
  await sendMail(email, role === 'workspace' ? 'You are invited to a Clausid workspace'
    : role === 'signer' ? 'You have a Clausid contract to sign' : 'You are invited to edit a Clausid contract',
    `Open this invitation and sign in with the verified email address it was sent to.\n\n${url.href}`)
}
