import { presenceColor } from '@clausid/contracts'
import type { Participant, PresenceUser } from '@clausid/contracts'
import type { Sharing, WorkspaceSession as Session } from './records.ts'

export const presenceLease = 90_000
export function participantIdentity(account: { id: string; email: string; name?: string | undefined }): PresenceUser {
  return { id: account.id, email: account.email, name: account.name?.trim().slice(0, 80) || account.email, color: presenceColor(account.id) }
}
export function isWorkspaceMember(state: Sharing, account: { id: string; email: string }) {
  return !state.deleting && [state.owner, ...state.parties].some((party) => party.id === account.id && party.email === account.email)
}
export function aggregateStatus(sessions: readonly Session[], now: number): Participant['status'] {
  const live = sessions.filter((session) => session.updatedAt + presenceLease > now && session.account.expires > now)
  if (live.some((session) => session.status === 'Editing' && session.updatedAt + 2_000 > now)) {
    return 'Editing'
  }
  if (live.some((session) => session.status !== 'Away')) {
    return 'Online'
  }
  return live.length ? 'Away' : 'Offline'
}
