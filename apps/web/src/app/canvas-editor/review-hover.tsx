import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/core'
import type { ContractView } from '@clausid/contracts'
import { VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { HoverCard } from '@astryxdesign/core/HoverCard'
import { Divider } from '@astryxdesign/core/Divider'
import { MessageSquare } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { ReviewHeading } from './review-heading.tsx'
import { hitsReview, reviewAnchors } from './review-anchors.ts'
import type { ReviewAnchor, ReviewItem } from './review-anchors.ts'
import type { Passage } from './navigation.ts'

const styles = stylex.create({
  markers: { position: 'absolute', inset: 0, pointerEvents: 'none' },
  marker: (left: number, top: number) => ({ position: 'absolute', left, top, pointerEvents: 'auto' }),
  anchor: (left: number, top: number, height: number) => ({ position: 'absolute', left, top, width: 1, height, pointerEvents: 'none' }),
  card: { width: 'calc(var(--spacing-8) * 10)', maxWidth: 'calc(100vw - var(--spacing-4))', maxHeight: '60vh', overflowY: 'auto' },
})
type Marker = { key: string; ids: string[]; top: number; left: number }
type Active = { key: string; ids: string[]; top: number; left: number; height: number }

function inPreview(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(target.closest('[data-review-preview]') || (target.matches('[popover]') && target.querySelector('[data-review-preview]')))
  )
}

function ReviewPreview({ item, contract, names }: { item: ReviewItem; contract: ContractView; names: ReadonlyMap<string, string> }) {
  const row = item.value
  const quote = item.kind === 'native' ? item.value.anchor.quote : (item.value.quote ?? item.value.edit?.expected)
  const replacement = item.kind === 'native' ? item.value.replacement : item.value.edit?.replacement
  const label = item.kind === 'pdf' && item.value.markup ? item.value.markup.tool + ' annotation' : replacement !== undefined ? 'Suggestion' : 'Comment'
  return (
    <VStack gap={2} data-testid="review-preview-row">
      <ReviewHeading contract={contract} author={row.author} createdAt={row.createdAt} names={names} />
      <Text type="supporting" color="secondary">
        {label} · {row.decision?.status ?? 'Open'}
      </Text>
      {quote && (
        <Text type="supporting" color="secondary">
          {quote.length > 120 ? quote.slice(0, 120) + '…' : quote}
        </Text>
      )}
      {replacement !== undefined && <Text>Proposed: {replacement || '(remove text)'}</Text>}
      {row.text && <Text>{row.text}</Text>}
      {row.replies.map((reply) => (
        <VStack key={reply.id} gap={0.5} paddingInline={2}>
          <Text type="supporting" color="secondary">
            {names.get(reply.author) ?? reply.author} · {new Date(reply.createdAt).toLocaleString()}
          </Text>
          <Text>{reply.text}</Text>
        </VStack>
      ))}
    </VStack>
  )
}

export function ReviewHover({
  artboard,
  editor,
  rows,
  contract,
  names,
  zoom,
  digest,
  enabled,
  onOpen,
}: {
  artboard: RefObject<HTMLElement | null>
  editor: Editor | null
  rows: readonly Passage[]
  contract: ContractView
  names: ReadonlyMap<string, string>
  zoom: string
  digest: string
  enabled: boolean
  onOpen: (item: ReviewItem) => void
}) {
  const [markers, setMarkers] = useState<Marker[]>([])
  const [items, setItems] = useState<ReviewItem[]>([])
  const [active, setActive] = useState<Active>()
  const activePreview = useRef(active)
  activePreview.current = active
  const anchors = useRef<ReviewAnchor[]>([])
  const markerList = useRef<Marker[]>([])
  const pointer = useRef<{ x: number; y: number } | undefined>(undefined)
  const lastPointer = useRef<{ x: number; y: number } | undefined>(undefined)
  const opening = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingKey = useRef('')
  function clearTimers() {
    if (opening.current) {
      clearTimeout(opening.current)
    }
    if (closing.current) {
      clearTimeout(closing.current)
    }
    opening.current = null
    closing.current = null
    pendingKey.current = ''
  }
  function hide() {
    lastPointer.current = undefined
    pointer.current = undefined
    clearTimers()
    setActive(undefined)
  }
  function keep() {
    if (closing.current) {
      clearTimeout(closing.current)
    }
    closing.current = null
  }
  function leave() {
    pointer.current = undefined
    if (opening.current) {
      clearTimeout(opening.current)
    }
    opening.current = null
    pendingKey.current = ''
    if (!closing.current) {
      closing.current = setTimeout(() => {
        closing.current = null
        const point = lastPointer.current
        const target = point ? window.document.elementFromPoint(point.x, point.y) : null
        if (
          point &&
          (inPreview(target) ||
            (target instanceof Element && target.closest('[data-review-marker]')) ||
            (target instanceof Node && artboard.current?.contains(target) && anchors.current.some((anchor) => hitsReview(anchor, point.x, point.y))))
        ) {
          return
        }
        setActive(undefined)
      }, 200)
    }
  }
  function show(value: Active, immediate = false) {
    keep()
    const key = value.key + ':' + value.ids.join(',') + ':' + value.top + ':' + value.left + ':' + value.height
    if (pendingKey.current === key) {
      return
    }
    if (opening.current) {
      clearTimeout(opening.current)
    }
    pendingKey.current = key
    const open = () => {
      opening.current = null
      setActive(value)
    }
    if (immediate) {
      open()
    } else {
      opening.current = setTimeout(open, 200)
    }
  }

  useEffect(() => {
    const root = artboard.current
    if (!root || !enabled) {
      return
    }
    let frame = 0
    const refresh = () => {
      frame = 0
      const next = reviewAnchors(root, editor, rows, contract)
      const bounds = root.getBoundingClientRect()
      const scale = Number(zoom)
      const groups: Marker[] = []
      for (const anchor of next) {
        const top = Math.max(0, (anchor.marker.top - bounds.top) / scale)
        const group = groups.find((candidate) => Math.abs(candidate.top - top) < 24)
        if (group) {
          group.ids.push(anchor.item.value.id)
        } else {
          groups.push({
            key: anchor.item.value.id,
            ids: [anchor.item.value.id],
            top,
            left: Math.max(0, Math.min(12, (anchor.marker.left - bounds.left) / scale - 28)),
          })
        }
      }
      anchors.current = next
      markerList.current = groups
      setItems(next.map((anchor) => anchor.item))
      setMarkers(groups)
      const previous = activePreview.current
      if (typeof Highlight !== 'undefined') {
        CSS.highlights.set('clausid-review-anchors', new Highlight(...next.flatMap((anchor) => anchor.ranges)))
      }
      if (pointer.current) {
        previewAt(pointer.current.x, pointer.current.y, Boolean(previous))
      } else if (previous) {
        const ids = previous.ids.filter((id) => next.some((anchor) => anchor.item.value.id === id))
        const marker = groups.find((group) => group.ids.some((id) => ids.includes(id)))
        if (marker && ids.length) {
          setActive({ ...previous, key: marker.key, ids })
        } else {
          hide()
        }
      }
    }
    const schedule = () => {
      if (!frame) {
        frame = requestAnimationFrame(refresh)
      }
    }
    const previewAt = (x: number, y: number, immediate = false) => {
      const selection = window.getSelection()
      if (selection?.rangeCount && !selection.isCollapsed && root.contains(selection.anchorNode)) {
        leave()
        return
      }
      const hits = anchors.current.filter((anchor) => hitsReview(anchor, x, y))
      const first = hits[0]
      const marker = first && markerList.current.find((value) => value.ids.includes(first.item.value.id))
      if (!marker) {
        if (immediate) {
          hide()
        } else {
          leave()
        }
        return
      }
      const rect = first?.rects.find((value) => y >= value.top && y <= value.bottom)
      const bounds = root.getBoundingClientRect()
      show(
        {
          key: marker.key,
          ids: hits.map((anchor) => anchor.item.value.id),
          top: Math.max(0, ((rect?.top ?? y - 6) - bounds.top) / Number(zoom)),
          height: (rect ? rect.bottom - rect.top : 12) / Number(zoom),
          left: (x - bounds.left) / Number(zoom),
        },
        immediate,
      )
    }
    const move = (event: PointerEvent) => {
      lastPointer.current = { x: event.clientX, y: event.clientY }
      if (inPreview(event.target)) {
        pointer.current = undefined
        keep()
        return
      }
      if (!(event.target instanceof Node) || !root.contains(event.target)) {
        pointer.current = undefined
        leave()
        return
      }
      if (event.buttons || (event.target instanceof Element && event.target.closest('[data-review-marker]'))) {
        pointer.current = undefined
        return
      }
      pointer.current = { x: event.clientX, y: event.clientY }
      previewAt(event.clientX, event.clientY)
    }
    const down = (event: PointerEvent) => {
      if (!inPreview(event.target)) {
        pointer.current = undefined
        hide()
      }
    }
    const leaveDocument = () => {
      lastPointer.current = undefined
      leave()
    }
    const selectionChanged = () => {
      const selected = window.getSelection()
      const target = selected?.anchorNode instanceof Element ? selected.anchorNode : selected?.anchorNode?.parentElement
      if (selected && !selected.isCollapsed && root.contains(selected.anchorNode) && !inPreview(target ?? null)) {
        hide()
      }
    }
    const scroll = (event: Event) => {
      if (inPreview(event.target)) {
        return
      }
      pointer.current = undefined
      hide()
      schedule()
    }
    const observer = new MutationObserver((records) => {
      if (records.some((record) => !(record.target instanceof Element) || !record.target.closest('[aria-label="Document review markers"]'))) {
        schedule()
      }
    })
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-pdf-item'] })
    const resize = new ResizeObserver(schedule)
    resize.observe(root)
    window.document.addEventListener('pointermove', move)
    window.document.addEventListener('pointerleave', leaveDocument)
    window.document.addEventListener('selectionchange', selectionChanged)
    root.addEventListener('pointerleave', leave)
    window.document.addEventListener('pointerdown', down)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', scroll)
    editor?.on('update', schedule)
    schedule()
    return () => {
      observer.disconnect()
      resize.disconnect()
      cancelAnimationFrame(frame)
      clearTimers()
      window.document.removeEventListener('pointermove', move)
      window.document.removeEventListener('pointerleave', leaveDocument)
      window.document.removeEventListener('selectionchange', selectionChanged)
      root.removeEventListener('pointerleave', leave)
      window.document.removeEventListener('pointerdown', down)
      window.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', scroll)
      editor?.off('update', schedule)
      CSS.highlights?.delete('clausid-review-anchors')
      CSS.highlights?.delete('clausid-hover-passage')
    }
  }, [artboard, editor, rows, contract.threads, contract.annotations, contract.sourcePdf, zoom, digest, enabled])

  useEffect(() => {
    if (typeof Highlight !== 'undefined' && active) {
      CSS.highlights.set(
        'clausid-hover-passage',
        new Highlight(...anchors.current.filter((anchor) => active.ids.includes(anchor.item.value.id)).flatMap((anchor) => anchor.ranges)),
      )
    }
    return () => {
      CSS.highlights?.delete('clausid-hover-passage')
    }
  }, [active])

  if (!enabled || !artboard.current || !markers.length) {
    return null
  }
  return createPortal(
    <VStack xstyle={styles.markers} role="group" aria-label="Document review markers">
      {markers.map((marker, index) => {
        const shown = active?.key === marker.key
        const ids = shown ? active.ids : marker.ids
        const previews = items.filter((item) => ids.includes(item.value.id))
        const first = previews[0]
        const quote = first?.kind === 'native' ? first.value.anchor.quote : first?.value.quote
        const markerPreview = () => {
          return { key: marker.key, ids: marker.ids, top: marker.top, height: 28, left: marker.left }
        }
        return (
          <VStack key={marker.key} xstyle={styles.marker(marker.left, marker.top)} data-review-marker>
            <HoverCard
              label="Passage discussion"
              placement="below"
              alignment="start"
              isOpen={shown}
              touchTrigger="none"
              xstyle={styles.card}
              onOpenChange={(open) => {
                if (!open) {
                  hide()
                }
              }}
              content={
                <VStack gap={3} data-review-preview onPointerEnter={keep} onPointerLeave={leave}>
                  <Text weight="semibold">{previews.length === 1 ? 'Discussion' : previews.length + ' discussions'}</Text>
                  {previews.map((item, itemIndex) => (
                    <VStack key={item.value.id} gap={3}>
                      {itemIndex > 0 && <Divider />}
                      <ReviewPreview item={item} contract={contract} names={names} />
                    </VStack>
                  ))}
                </VStack>
              }
            >
              <VStack
                xstyle={styles.anchor(shown ? active.left - marker.left : 0, shown ? active.top - marker.top : 0, shown ? active.height : 1)}
                aria-hidden
              />
            </HoverCard>
            <IconButton
              label={'Discussion ' + (index + 1) + ': ' + (quote?.slice(0, 80) ?? 'Document annotation')}
              icon={<Icon icon={MessageSquare} size="sm" />}
              variant="ghost"
              size="sm"
              width={24}
              aria-expanded={shown}
              aria-haspopup="dialog"
              onPointerEnter={() => show(markerPreview())}
              onPointerLeave={leave}
              onFocus={(event) => {
                if (event.currentTarget.matches(':focus-visible')) {
                  pointer.current = undefined
                  show(markerPreview(), true)
                }
              }}
              onBlur={leave}
              onClick={() => {
                hide()
                if (first) {
                  onOpen(first)
                }
              }}
            />
          </VStack>
        )
      })}
    </VStack>,
    artboard.current,
  )
}
