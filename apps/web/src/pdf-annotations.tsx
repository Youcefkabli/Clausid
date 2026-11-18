import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Banner } from '@astryxdesign/core/Banner'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { Selector } from '@astryxdesign/core/Selector'
import { Button } from '@astryxdesign/core/Button'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { Divider } from '@astryxdesign/core/Divider'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Heading, Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { api, errorMessage } from './api.ts'
import type { ContractView, PdfAnnotationChange, PdfTextBlock } from '@clausid/contracts'

export function PdfAnnotations({ contract, open, onOpenChange, propose, setPropose, save, busy, error }: {
  contract: ContractView
  open: boolean
  onOpenChange: (open: boolean) => void
  propose: boolean
  setPropose: (enabled: boolean) => void
  save: (change: PdfAnnotationChange) => Promise<unknown>
  busy: boolean
  error: string
}) {
  const [page, setPage] = useState('1')
  const [text, setText] = useState('')
  const [block, setBlock] = useState('')
  const [expected, setExpected] = useState('')
  const [replacement, setReplacement] = useState('')
  const [sourceLines, setSourceLines] = useState<{ page: string; blocks: PdfTextBlock[]; error?: string }>()
  const [replyTo, setReplyTo] = useState<string>()
  const [reply, setReply] = useState('')
  const writable = contract.status === 'Draft' && contract.role !== 'signer'
  const pages = contract.sourcePdf?.pages ?? 0
  const validPage = Number.isInteger(Number(page)) && Number(page) >= 1 && Number(page) <= pages

  useEffect(() => {
    if (!open || !writable || !propose || !validPage) return
    const abort = new AbortController()
    void api<PdfTextBlock[]>('/' + contract.id + '/text-blocks?page=' + Number(page), undefined, abort.signal)
      .then(blocks => { if (!abort.signal.aborted) setSourceLines({ page, blocks }) })
      .catch(reason => { if (!abort.signal.aborted) setSourceLines({ page, blocks: [], error: errorMessage(reason) }) })
    return () => abort.abort()
  }, [contract.id, open, page, propose, validPage, writable])

  const lines = sourceLines?.page === page ? sourceLines : undefined
  const selected = lines?.blocks.find(line => String(line.block) === block)
  const canAdd = !busy && validPage && (propose
    ? Boolean(selected && expected && selected.text.includes(expected) && expected !== replacement)
    : Boolean(text.trim()))

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canAdd) return
    const edit = propose && selected ? { block: selected.block, expected, replacement } : undefined
    if (await save({ action: 'add', page: Number(page), text, replacement: edit })) {
      setText('')
      setExpected('')
      setReplacement('')
      setBlock('')
      setPropose(false)
    }
  }

  async function sendReply(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault()
    if (!reply.trim() || busy) return
    if (await save({ action: 'reply', id, text: reply })) {
      setReply('')
      setReplyTo(undefined)
    }
  }

  function viewPage(number: number) {
    onOpenChange(false)
    requestAnimationFrame(() => document.getElementById('contract-pdf-page-' + number)?.scrollIntoView({ block: 'start' }))
  }

  return <Dialog isOpen={open} onOpenChange={onOpenChange} purpose="form" width={560}>
    <DialogHeader title="PDF annotations" onOpenChange={onOpenChange} />
    <VStack padding={4} gap={3}>
      {error && <Banner status="error" role="alert" title={error} />}
      {writable && <form onSubmit={add}>
        <VStack gap={2}>
          <TextInput label={`Page (1–${pages})`} value={page} onChange={value => {
            setPage(value); setBlock(''); setExpected(''); setReplacement('')
          }} />
          <CheckboxInput label="Propose a text replacement" value={propose} onChange={setPropose} />
          {propose && validPage && <>
            {lines?.error && <Banner status="error" role="alert" title={lines.error} />}
            {!lines?.error && <Selector label="Source line" value={block} placeholder="Choose a line"
              isLoading={!lines} isDisabled={!lines?.blocks.length}
              options={lines?.blocks.map(line => ({
                value: String(line.block), label: (line.block + 1) + '. ' + line.text.slice(0, 100),
              })) ?? []}
              onChange={value => {
                const line = lines?.blocks.find(item => String(item.block) === value)
                setBlock(value); setExpected(line && line.text.length <= 800 ? line.text : ''); setReplacement('')
              }} />}
            {selected && <>
              <TextArea label="Text to replace" value={expected} onChange={setExpected} maxLength={800} rows={2}
                description="Enter an exact phrase that occurs once in this source line." />
              <TextArea label="Replacement text" value={replacement} onChange={setReplacement} maxLength={800} rows={2}
                description="Use text that fits within the original space. An empty replacement removes the selected phrase." />
            </>}
          </>}
          <TextArea label="Annotation" value={text} onChange={setText} maxLength={800} rows={3} />
          <HStack><Button label="Add annotation" type="submit" variant="primary" isDisabled={!canAdd} /></HStack>
        </VStack>
      </form>}
      <Heading level={3}>Negotiation history</Heading>
      {!contract.annotations?.filter(item => !item.withdrawn).length && <Text color="secondary">No annotations yet.</Text>}
      {contract.annotations?.filter(item => !item.withdrawn).map(annotation => <VStack key={annotation.id} gap={2}>
        <Divider />
        <HStack gap={2} wrap="wrap" vAlign="center">
          <Button label={`View page ${annotation.page}`} size="sm" variant="ghost" onClick={() => viewPage(annotation.page)} />
          <Text type="supporting">{annotation.decision?.status ?? 'Open'}</Text>
        </HStack>
        <Text type="supporting" color="secondary">{annotation.author} · {new Date(annotation.createdAt).toLocaleString()}</Text>
        {annotation.edit && <VStack gap={0.5}>
          <Text>Original: {annotation.edit.expected}</Text>
          <Text>Replacement: {annotation.edit.replacement || '(remove text)'}</Text>
        </VStack>}
        {annotation.markup && <Text>{annotation.markup.tool} annotation</Text>}
        {annotation.text && <Text>{annotation.text}</Text>}
        {annotation.replies.map(item => <VStack key={item.id} gap={0.5} paddingInline={2}>
          <Text type="supporting" color="secondary">{item.author} · {new Date(item.createdAt).toLocaleString()}</Text>
          <Text>{item.text}</Text>
        </VStack>)}
        {annotation.decision && <Text type="supporting" color="secondary">
          {annotation.decision.status} by {annotation.decision.author} · {new Date(annotation.decision.at).toLocaleString()}
        </Text>}
        {writable && !annotation.decision && <>
          <HStack gap={2} wrap="wrap">
            <Button label="Reply" onClick={() => { setReplyTo(annotation.id); setReply('') }} isDisabled={busy} />
            {contract.role === 'owner' && <>
              <Button label="Approve" onClick={() => void save({ action: 'decide', id: annotation.id, decision: 'Approved' })} isDisabled={busy} />
              <Button label="Reject" onClick={() => void save({ action: 'decide', id: annotation.id, decision: 'Rejected' })} isDisabled={busy} />
            </>}
          </HStack>
          {replyTo === annotation.id && <form onSubmit={event => void sendReply(event, annotation.id)}>
            <VStack gap={2}>
              <TextArea label="Reply to annotation" value={reply} onChange={setReply} maxLength={800} rows={2} />
              <HStack><Button label="Post reply" type="submit" variant="primary" isDisabled={busy || !reply.trim()} /></HStack>
            </VStack>
          </form>}
        </>}
      </VStack>)}
    </VStack>
  </Dialog>
}
