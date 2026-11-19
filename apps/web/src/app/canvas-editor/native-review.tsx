import type { ContractView, NativeAnchor, ReviewChange } from '@clausid/contracts'
import { useRef, useState } from 'react'
import { Text, Heading } from '@astryxdesign/core/Text'
import { Button } from '@astryxdesign/core/Button'
import { TextArea } from '@astryxdesign/core/TextArea'
import { VStack, HStack } from '@astryxdesign/core/Stack'
import { Divider } from '@astryxdesign/core/Divider'

export type SaveReview = (change: ReviewChange, requestId: string) => Promise<unknown>
export function NativeReview({
  contract,
  anchor,
  suggest,
  save,
  busy,
  email,
  visit,
}: {
  contract: ContractView
  anchor?: NativeAnchor
  suggest: boolean
  save: SaveReview
  busy: boolean
  email: string
  visit: (anchor: NativeAnchor) => void
}) {
  const [text, setText] = useState('')
  const [reply, setReply] = useState('')
  const [replyId, setReplyId] = useState('')
  const retry = useRef({ body: '', id: '' })
  const writable = contract.status === 'Draft' && contract.role !== 'signer'
  const threads = contract.threads?.filter((item) => (item.replacement !== undefined) === suggest) ?? []
  async function submit(change: Parameters<SaveReview>[0]) {
    const body = JSON.stringify(change)
    if (body !== retry.current.body) {
      retry.current = { body, id: crypto.randomUUID() }
    }
    const result = await save(change, retry.current.id)
    if (result) {
      retry.current.body = ''
    }
    return result
  }
  return (
    <VStack gap={3}>
      {writable && (
        <VStack gap={2}>
          <Text>{anchor?.quote ?? 'Select a passage in the draft.'}</Text>
          <TextArea label={suggest ? 'Replacement text' : 'Comment'} value={text} onChange={setText} maxLength={800} />
          <Button
            label={suggest ? 'Submit suggestion' : 'Post comment'}
            isDisabled={busy || !anchor || (suggest ? text === anchor.quote : !text.trim())}
            onClick={async () => {
              if (anchor && (await submit({ action: 'add', anchor, text: suggest ? '' : text, replacement: suggest ? text : undefined }))) {
                setText('')
              }
            }}
          />
        </VStack>
      )}
      {threads.length === 0 && <Text color="secondary">{suggest ? 'No suggestions yet.' : 'No comments yet.'}</Text>}
      {threads.map((item) => (
        <VStack key={item.id} gap={2}>
          <Divider />
          <Heading level={4}>{item.author}</Heading>
          <Button label={item.anchor.quote} variant="ghost" onClick={() => visit(item.anchor)} />
          <Text>{suggest ? 'Replacement: ' + (item.replacement || '(remove text)') : item.text}</Text>
          <Text type="supporting">{item.decision?.status ?? 'Open'}</Text>
          {item.replies.map((row) => (
            <Text key={row.id}>
              {row.author} · {row.text}
            </Text>
          ))}
          {writable && (
            <HStack gap={1} wrap="wrap">
              {!item.decision && (
                <Button
                  label="Reply"
                  onClick={() => {
                    setReplyId(item.id)
                    setReply('')
                  }}
                />
              )}
              {suggest &&
                !item.decision &&
                contract.role === 'owner' &&
                (['Approved', 'Rejected'] as const).map((decision) => (
                  <Button
                    key={decision}
                    label={decision === 'Approved' ? 'Approve' : 'Reject'}
                    isDisabled={busy}
                    onClick={() => void submit({ action: 'decide', id: item.id, decision })}
                  />
                ))}
              {!suggest && (contract.role === 'owner' || email === item.author) && (
                <Button
                  label={item.decision ? 'Reopen' : 'Resolve'}
                  isDisabled={busy}
                  onClick={() => void submit({ action: 'decide', id: item.id, decision: item.decision ? 'Reopened' : 'Resolved' })}
                />
              )}
            </HStack>
          )}
          {writable && !item.decision && replyId === item.id && (
            <VStack gap={1}>
              <TextArea label="Reply" value={reply} onChange={setReply} maxLength={800} />
              <Button
                label="Post reply"
                isDisabled={busy || !reply.trim()}
                onClick={async () => {
                  if (await submit({ action: 'reply', id: item.id, text: reply })) {
                    setReplyId('')
                  }
                }}
              />
            </VStack>
          )}
        </VStack>
      ))}
    </VStack>
  )
}
