import { useEffect, useRef, useState } from 'react'
import type { Doc } from 'yjs'
import type { Participant } from '@clausid/contracts'
import * as stylex from '@stylexjs/stylex'
import { Button } from '@astryxdesign/core/Button'
import { Avatar } from '@astryxdesign/core/Avatar'
import { AvatarGroup, AvatarGroupOverflow } from '@astryxdesign/core/AvatarGroup'
import { Icon } from '@astryxdesign/core/Icon'
import { Users } from 'lucide-react'
import { Banner } from '@astryxdesign/core/Banner'
import { List, ListItem } from '@astryxdesign/core/List'
import { Link } from '@astryxdesign/core/Link'
import { HStack, VStack, Layout, LayoutContent } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { connectWorkspacePresence } from './workspace-connection.ts'
import type { WorkspacePresenceState } from './workspace-connection.ts'

const styles = stylex.create({
  marker: (color: string) => ({
    backgroundColor: color,
    width: 'var(--spacing-2)',
    height: 'var(--spacing-2)',
    borderRadius: 'var(--radius-full)',
    outline: `var(--spacing-0-5) solid color-mix(in srgb, ${color} 50%, var(--color-text-primary))`,
    flexShrink: 0,
  }),
})
export function MemberColor({ color }: { color: string }) {
  return <HStack aria-hidden="true" xstyle={styles.marker(color)} />
}
export function useWorkspacePresence(workspaceId: string | undefined, contractId: string | null = null, draft?: Doc) {
  const [state, setState] = useState<WorkspacePresenceState>({ participants: [], ready: false, error: '', retryable: false })
  const retry = useRef<() => void>(() => undefined)
  useEffect(() => {
    setState({ participants: [], ready: false, error: '', retryable: false })
    if (!workspaceId) {
      return
    }
    const connection = connectWorkspacePresence(workspaceId, setState, contractId, draft)
    retry.current = () => connection.retry()
    return () => connection.dispose()
  }, [workspaceId, contractId, draft])
  return { ...state, retry: () => retry.current() }
}
export type Presence = ReturnType<typeof useWorkspacePresence>
export function ParticipantRows({ participants, roles }: { participants: readonly Participant[]; roles?: ReadonlyMap<string, string> }) {
  return (
    <List edge="flush" aria-label="Participants">
      {participants.map((person) => (
        <ListItem
          key={person.id}
          align="first-line"
          label={person.name}
          startContent={<MemberColor color={person.color} />}
          description={
            <VStack gap={0.5}>
              <Text type="supporting" color="secondary">
                {person.email}
              </Text>
              <Text type="supporting">
                {roles?.has(person.id) ? roles.get(person.id) + ' · ' : ''}
                {person.status}
                {person.working && !person.documents.length ? ' · Working in a document' : ''}
              </Text>
              {person.documents.map((doc) => (
                <Link key={doc.id} href={'/contracts/' + doc.id}>
                  {doc.title}
                </Link>
              ))}
            </VStack>
          }
        />
      ))}
    </List>
  )
}
export function PresenceFeedback({ presence }: { presence: Presence }) {
  return (
    <>
      {presence.error && <Banner status="warning" title={presence.error} />}
      {presence.retryable && <Button label="Retry workspace presence" onClick={presence.retry} />}
      {!presence.ready && !presence.error && <Text type="supporting">Connecting workspace presence…</Text>}
    </>
  )
}
export function ParticipantsButton({ presence, onClick, compact = false }: { presence: Presence; onClick: () => void; compact?: boolean }) {
  const active = presence.participants.filter((person) => person.status !== 'Offline')
  const label = presence.ready ? `${active.length} online` : 'Participants'
  const tooltip = active.map((person) => person.name).join(', ') || 'Workspace participants'
  const visible = compact && active.length > 2 ? 1 : compact ? 2 : 3
  const avatars = (
    <AvatarGroup size={compact ? 16 : 'sm'} aria-hidden="true" data-testid="online-member-avatars">
      {active.slice(0, visible).map((person) => (
        <Avatar
          key={person.id}
          name={person.name}
          tooltip={false}
          status={<HStack aria-hidden="true" data-testid="online-member-color" xstyle={styles.marker(person.color)} />}
        />
      ))}
      {active.length > visible && <AvatarGroupOverflow count={active.length - visible} />}
    </AvatarGroup>
  )
  if (compact || !active.length) {
    return (
      <Button
        label={label}
        tooltip={tooltip}
        icon={active.length ? avatars : <Icon icon={Users} size="sm" />}
        isIconOnly
        size="sm"
        variant="ghost"
        onClick={onClick}
      />
    )
  }
  return (
    <Button label={label} size="sm" variant="ghost" onClick={onClick} tooltip={tooltip}>
      {avatars}
    </Button>
  )
}
export function WorkspaceParticipants({ workspaceId }: { workspaceId: string }) {
  const presence = useWorkspacePresence(workspaceId)
  const [open, setOpen] = useState(false)
  return (
    <>
      <ParticipantsButton presence={presence} onClick={() => setOpen(true)} />
      <Dialog isOpen={open} onOpenChange={setOpen} aria-label="Workspace participants">
        <Layout
          padding={4}
          defaultHasDividers
          header={<DialogHeader title="Workspace participants" onOpenChange={setOpen} />}
          content={
            <LayoutContent>
              <VStack gap={3}>
                <PresenceFeedback presence={presence} />
                <ParticipantRows participants={presence.participants} />
              </VStack>
            </LayoutContent>
          }
        />
      </Dialog>
    </>
  )
}
