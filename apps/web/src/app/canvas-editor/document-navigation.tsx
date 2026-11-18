import { useMemo, useState } from 'react'
import type { OutlineCorrection } from '@clausid/contracts'
import { VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { Button } from '@astryxdesign/core/Button'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Selector } from '@astryxdesign/core/Selector'
import { Item } from '@astryxdesign/core/Item'
import { indexEntries, outline, type Passage } from './navigation.ts'
import type { SaveReview } from './native-review.tsx'

export function DocumentNavigation({ mode, passages, corrections, visit, current, writable, save }: {
  mode: string; passages: Passage[]; corrections: OutlineCorrection[]; visit: (row: Passage) => void
  current?: Passage; writable: boolean; save: SaveReview
}) {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Passage>()
  const [title, setTitle] = useState('')
  const [level, setLevel] = useState('1')
  const [picked, setPicked] = useState<Passage>()
  const sections = useMemo(() => outline(passages, corrections), [passages, corrections])
  const index = useMemo(() => mode === 'Index' ? indexEntries(passages, query, corrections) : [], [mode, passages, query, corrections])
  function navigate(row: Passage) { setPicked(row); visit(row) }
  const target = current ?? picked
  const activeSection = target && (sections.find(section => section.key === target.key) ?? sections.findLast(section =>
    target.position !== undefined ? section.position !== undefined && section.position <= target.position
      : section.page !== undefined && (section.page < target.page! || (section.page === target.page && (section.item ?? -1) <= (target.item ?? 0)))))
  async function correct(hidden: boolean) {
    if (editing && await save({action: 'outline', key: editing.key, title, level: Number(level), hidden}, crypto.randomUUID())) setEditing(undefined)
  }
  return <VStack gap={2}>
    <TextInput label={'Search ' + mode.toLowerCase()} value={query} onChange={setQuery} />
    {mode === 'Sections' ? <>
      {sections.filter(row => (row.title ?? row.text).toLowerCase().includes(query.toLowerCase())).map(row =>
        <VStack key={row.key} paddingInline={([0,0,2,4,6,8,10] as const)[Math.min(row.level ?? 1,6)]}>
          <Item label={row.title ?? row.text} density="compact" isSelected={activeSection?.key === row.key} onClick={() => navigate(row)} />
        </VStack>)}
      {!sections.length && <Text color="secondary">Headings and numbered clauses appear here.</Text>}
      {writable && target && <Button label="Edit section" size="sm" onClick={() => {
        const row = sections.find(item => item.key === target.key) ?? target
        setEditing(row); setTitle((row.title ?? row.text).slice(0,180)); setLevel(String(row.level ?? 1))
      }} />}
      {editing && <VStack gap={2}>
        <TextInput label="Section title" value={title} onChange={value => setTitle(value.slice(0, 180))}/>
        <Selector label="Nesting level" value={level} onChange={setLevel} options={['1','2','3','4','5','6']}/>
        <Button label="Save section" isDisabled={!title.trim()} onClick={() => void correct(false)}/>
        <Button label="Hide from outline" onClick={() => void correct(true)}/>
        <Button label="Cancel" variant="ghost" onClick={() => setEditing(undefined)}/>
      </VStack>}
    </> : <>
      {index.map(([label, occurrences]) => <VStack key={label} gap={1}>
        <Text weight="semibold">{label}</Text>
        {occurrences.map((row,i) => <Item key={i} density="compact" label={(row.description ? row.description + ' · ' : '') + (row.page ? 'Page ' + row.page : 'Passage ' + (i + 1)) + ' · ' + row.text}
          onClick={() => navigate(row)}/>)}
      </VStack>)}
      {!index.length && <Text color="secondary">{query ? 'No matching passages.' : 'Defined terms and clause references appear here. Search for any wording.'}</Text>}
    </>}
  </VStack>
}
