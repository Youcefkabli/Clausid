import { pdfTextBlocksSchema } from '@clausid/contracts'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Banner } from '@astryxdesign/core/Banner'
import { Selector } from '@astryxdesign/core/Selector'
import { Button } from '@astryxdesign/core/Button'
import { matchSourceBlock, type PdfSelection } from './pdf-selection.ts'
import { Divider } from '@astryxdesign/core/Divider'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Heading, Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { api, errorMessage } from './api.ts'
import type { ContractView, PdfAnnotationChange, PdfLocation, PdfTextBlock } from '@clausid/contracts'
import { ReviewHeading, ReviewFilter, reviewStyles } from './app/canvas-editor/review-heading.tsx'

export function PdfAnnotations({
  contract,
  selection,
  propose,
  save,
  busy,
  error,
  visit,
  activeId,
  names,
  onPick,
}: {
  contract: ContractView
  names: ReadonlyMap<string, string>
  activeId: string | undefined
  onPick: (id: string) => void
  selection?: PdfSelection
  visit: (page: number, quote?: string, location?: PdfLocation) => void
  propose: boolean
  save: (change: PdfAnnotationChange) => Promise<unknown>
  busy: boolean
  error: string
}) {
  const [page, setPage] = useState(String(selection?.page ?? 1))
  const retry = useRef({ body: '', id: '' })
  const [manualDigest, setManualDigest] = useState<string>()
  const [manual, setManual] = useState(false)
  const [text, setText] = useState('')
  const [block, setBlock] = useState('')
  const [expected, setExpected] = useState('')
  const [replacement, setReplacement] = useState('')
  const [sourceLines, setSourceLines] = useState<{ page: string; blocks: PdfTextBlock[]; error?: string }>()
  const [replyTo, setReplyTo] = useState<string>()
  const [reply, setReply] = useState('')
  const [filter, setFilter] = useState('All')
  const writable = contract.status === 'Draft' && contract.role !== 'signer'
  const pages = contract.sourcePdf?.pages ?? 0
  const validPage = Number.isInteger(Number(page)) && Number(page) >= 1 && Number(page) <= pages

  useEffect(() => {
    if (!writable || !propose || !validPage) {
      return
    }
    const abort = new AbortController()
    void api(pdfTextBlocksSchema, '/' + contract.id + '/text-blocks?page=' + Number(page), undefined, abort.signal)
      .then((blocks) => {
        if (!abort.signal.aborted) {
          setSourceLines({ page, blocks })
        }
      })
      .catch((reason) => {
        if (!abort.signal.aborted) {
          setSourceLines({ page, blocks: [], error: errorMessage(reason) })
        }
      })
    return () => abort.abort()
  }, [contract.id, page, propose, validPage, writable])

  const lines = sourceLines?.page === page ? sourceLines : undefined
  const unique = selection && lines && matchSourceBlock(selection, lines.blocks, contract.annotations ?? [])
  const automatic = !!selection && !manual
  const digest = contract.negotiatedPdf?.digest ?? contract.sourcePdf?.digest
  const displayed = selection?.digest ?? manualDigest ?? digest
  const stale = displayed !== digest
  const mappedBlock = automatic ? unique && String(unique.block) : block
  const phrase = automatic ? selection.quote : expected
  const selected = lines?.blocks.find((line) => String(line.block) === mappedBlock)
  const canAdd =
    !busy && !stale && validPage && (propose ? Boolean(selected && phrase && selected.text.includes(phrase) && phrase !== replacement) : Boolean(text.trim()))

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canAdd) {
      return
    }
    const edit = propose && selected ? { block: selected.block, expected: phrase, replacement } : undefined
    const location =
      selection?.singleLine && selection.run && selection.offset !== undefined && !manual
        ? { x: selection.run.x, y: selection.run.y, offset: selection.offset }
        : undefined
    const change = { location, action: 'add' as const, page: Number(page), text, replacement: edit, displayedDigest: displayed, quote: selection?.quote }
    const body = JSON.stringify(change)
    if (retry.current.body !== body) {
      retry.current = { body, id: crypto.randomUUID() }
    }
    if (await save({ ...change, requestId: retry.current.id })) {
      retry.current.body = ''
      setText('')
      setExpected('')
      setReplacement('')
      setBlock('')
      setManualDigest(undefined)
    }
  }

  async function sendReply(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault()
    if (!reply.trim() || busy) {
      return
    }
    if (await save({ action: 'reply', id, text: reply })) {
      setReply('')
      setReplyTo(undefined)
    }
  }

  return (
    <VStack gap={3}>
      {error && <Banner status="error" role="alert" title={error} />}
      {writable && (
        <form onSubmit={add}>
          <VStack gap={2}>
            <TextInput
              label={`Page (1–${pages})`}
              value={page}
              isReadOnly={!!selection}
              onChange={(value) => {
                setPage(value)
                setBlock('')
                setExpected('')
                setReplacement('')
              }}
            />
            {selection && <Text>Selected passage: {selection.quote}</Text>}
            {stale && <Banner status="warning" title="The PDF changed. Select the passage again." />}
            {automatic && propose && lines && !unique && (
              <Text>
                {selection.singleLine
                  ? 'This wording cannot be uniquely matched to an original source line.'
                  : 'Select wording from one source line for a replacement.'}{' '}
                You can comment on this passage.
              </Text>
            )}
            {propose && validPage && (
              <>
                {lines?.error && <Banner status="error" role="alert" title={lines.error} />}
                {!lines?.error && (
                  <Selector
                    label="Source line"
                    value={mappedBlock ?? ''}
                    placeholder="Choose a line"
                    isLoading={!lines}
                    isDisabled={!lines?.blocks.length}
                    options={
                      lines?.blocks.map((line) => ({
                        value: String(line.block),
                        label: line.block + 1 + '. ' + line.text.slice(0, 100),
                      })) ?? []
                    }
                    onChange={(value) => {
                      setManualDigest(digest)
                      setManual(true)
                      const line = lines?.blocks.find((item) => String(item.block) === value)
                      setBlock(value)
                      setExpected(line && line.text.length <= 800 ? line.text : '')
                      setReplacement('')
                    }}
                  />
                )}
                {selected && (
                  <>
                    <TextArea
                      label="Text to replace"
                      value={phrase}
                      onChange={(value) => {
                        setManual(true)
                        setBlock(mappedBlock ?? '')
                        setExpected(value)
                      }}
                      maxLength={800}
                      rows={2}
                      description="Enter an exact phrase that occurs once in this source line."
                    />
                    <TextArea
                      label="Replacement text"
                      value={replacement}
                      onChange={setReplacement}
                      maxLength={800}
                      rows={2}
                      description="Use text that fits within the original space. An empty replacement removes the selected phrase."
                    />
                  </>
                )}
              </>
            )}
            <TextArea label="Annotation" value={text} onChange={setText} maxLength={800} rows={3} />
            <HStack>
              <Button label={propose ? 'Submit suggestion' : 'Add annotation'} type="submit" variant="primary" isDisabled={!canAdd} />
            </HStack>
          </VStack>
        </form>
      )}
      <Heading level={3}>Negotiation history</Heading>
      {!!contract.annotations?.filter((item) => !item.withdrawn && !!item.edit === propose).length && (
        <ReviewFilter
          value={filter}
          onChange={setFilter}
          open={contract.annotations.filter((item) => !item.withdrawn && !!item.edit === propose && !item.decision).length}
          states={['Approved', 'Rejected']}
        />
      )}
      {!contract.annotations?.filter((item) => !item.withdrawn && !!item.edit === propose).length && <Text color="secondary">No annotations yet.</Text>}
      {contract.annotations
        ?.filter((item) => !item.withdrawn && !!item.edit === propose && (filter === 'All' || (item.decision?.status ?? 'Open') === filter))
        .map((annotation) => (
          <VStack
            key={annotation.id}
            gap={2}
            id={'review-' + annotation.id}
            tabIndex={-1}
            xstyle={[reviewStyles.row, activeId === annotation.id && reviewStyles.active]}
          >
            <Divider />
            <ReviewHeading names={names} contract={contract} author={annotation.author} createdAt={annotation.createdAt} />
            <HStack gap={2} wrap="wrap" vAlign="center">
              <Button
                label={`View page ${annotation.page}`}
                size="sm"
                variant="ghost"
                onClick={() => {
                  onPick(annotation.id)
                  visit(
                    annotation.page,
                    annotation.edit?.replacement && annotation.decision?.status === 'Approved'
                      ? annotation.edit.replacement
                      : (annotation.quote ?? annotation.edit?.expected),
                    annotation.location,
                  )
                }}
              />
              <Text type="supporting">{annotation.decision?.status ?? 'Open'}</Text>
            </HStack>
            {annotation.edit && (
              <VStack gap={0.5}>
                <Text>Original: {annotation.edit.expected}</Text>
                <Text>Replacement: {annotation.edit.replacement || '(remove text)'}</Text>
              </VStack>
            )}
            {annotation.markup && <Text>{annotation.markup.tool} annotation</Text>}
            {annotation.quote && !annotation.edit && <Text>{annotation.quote}</Text>}
            {annotation.text && <Text>{annotation.text}</Text>}
            {annotation.replies.map((item) => (
              <VStack key={item.id} gap={0.5} paddingInline={2}>
                <Text type="supporting" color="secondary">
                  {item.author} · {new Date(item.createdAt).toLocaleString()}
                </Text>
                <Text>{item.text}</Text>
              </VStack>
            ))}
            {annotation.decision && (
              <Text type="supporting" color="secondary">
                {annotation.decision.status} by {annotation.decision.author} · {new Date(annotation.decision.at).toLocaleString()}
              </Text>
            )}
            {writable && !annotation.decision && (
              <>
                <HStack gap={2} wrap="wrap">
                  <Button
                    label="Reply"
                    size="sm"
                    onClick={() => {
                      setReplyTo(annotation.id)
                      setReply('')
                    }}
                    isDisabled={busy}
                  />
                  {contract.role === 'owner' && (
                    <>
                      <Button
                        label="Approve"
                        size="sm"
                        onClick={() => void save({ action: 'decide', id: annotation.id, decision: 'Approved' })}
                        isDisabled={busy}
                      />
                      <Button
                        label="Reject"
                        size="sm"
                        onClick={() => void save({ action: 'decide', id: annotation.id, decision: 'Rejected' })}
                        isDisabled={busy}
                      />
                    </>
                  )}
                </HStack>
                {replyTo === annotation.id && (
                  <form onSubmit={(event) => void sendReply(event, annotation.id)}>
                    <VStack gap={2}>
                      <TextArea label="Reply to annotation" value={reply} onChange={setReply} maxLength={800} rows={2} />
                      <HStack>
                        <Button label="Post reply" type="submit" variant="primary" isDisabled={busy || !reply.trim()} />
                      </HStack>
                    </VStack>
                  </form>
                )}
              </>
            )}
          </VStack>
        ))}
    </VStack>
  )
}
