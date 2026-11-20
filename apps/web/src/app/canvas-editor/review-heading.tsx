import type { ContractView } from '@clausid/contracts'
import { Avatar } from '@astryxdesign/core/Avatar'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { Selector } from '@astryxdesign/core/Selector'
import * as stylex from '@stylexjs/stylex'

export const reviewStyles = stylex.create({
  row: { borderRadius: 'var(--radius-element)', padding: 'var(--spacing-2)' },
  active: { backgroundColor: 'var(--color-background-muted)', boxShadow: 'inset 2px 0 0 var(--color-border-emphasized)' },
})

export function ReviewHeading({
  contract,
  author,
  createdAt,
  names,
}: {
  contract: ContractView
  author: string
  createdAt: string
  names: ReadonlyMap<string, string>
}) {
  const name = names.get(author) ?? contract.team?.find((person) => person.email === author)?.name ?? author
  return (
    <HStack gap={2} vAlign="center">
      <Avatar name={name} size="sm" />
      <VStack gap={0}>
        <Text weight="semibold">{name}</Text>
        <Text type="supporting" color="secondary">
          {new Date(createdAt).toLocaleString()}
        </Text>
      </VStack>
    </HStack>
  )
}

export function ReviewFilter({ value, onChange, open, states }: { value: string; onChange: (value: string) => void; open: number; states: readonly string[] }) {
  return (
    <VStack gap={2}>
      <Text type="supporting" color="secondary">
        {open} open
      </Text>
      <Selector
        label="Review filter"
        isLabelHidden
        value={value}
        onChange={onChange}
        options={[
          { value: 'All', label: 'All activity' },
          { value: 'Open', label: 'Open only' },
          ...states.map((state) => ({ value: state, label: state + ' only' })),
        ]}
      />
    </VStack>
  )
}
