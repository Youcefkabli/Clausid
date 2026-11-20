import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Editor } from '@tiptap/core'
import type { NativeAnchor } from '@clausid/contracts'
import { nativeLinkSchema, nativeTextColors } from '@clausid/contracts'
import { Button } from '@astryxdesign/core/Button'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Icon } from '@astryxdesign/core/Icon'
import { Toolbar } from '@astryxdesign/core/Toolbar'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { DropdownMenu, DropdownMenuItem, DropdownMenuSubMenu } from '@astryxdesign/core/DropdownMenu'
import { Drawer, DrawerHeader } from '@astryxdesign/core/Drawer'
import { useLayer } from '@astryxdesign/core/Layer'
import { useMediaQuery } from '@astryxdesign/core/hooks'
import { Bold, Italic, Underline, Strikethrough, Link, MessageSquare, Replace, ArrowUp, X, Ellipsis, Highlighter, List, ListOrdered, Quote } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { nativeSelection, locateNative } from './navigation.ts'
import type { PdfSelection, PdfTextMarkTool } from '../../pdf-selection.ts'

export type ReviewTarget = { kind: 'native'; anchor: NativeAnchor } | { kind: 'pdf'; selection: PdfSelection }
type Mode = 'toolbar' | 'comment' | 'link'
const styles = stylex.create({
  surface: {
    borderRadius: 'var(--radius-container)',
    boxShadow: 'var(--shadow-med)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-background-surface)',
    maxWidth: 'calc(100vw - var(--spacing-4))',
  },
  composer: { width: 336, maxWidth: 'calc(100vw - var(--spacing-4))' },
  compactComposer: { width: '100%', maxWidth: '100%', boxShadow: 'none', borderWidth: 0, padding: 0, boxSizing: 'border-box' },
  quote: { maxHeight: 64, overflowY: 'auto', borderInlineStart: '2px solid var(--color-border-emphasized)', paddingInlineStart: 'var(--spacing-2)' },
})

export function SelectionTools({
  editor,
  artboard,
  pdfSelection,
  writable,
  busy,
  error,
  onComment,
  onAnnotate,
  annotationSlots,
  onSuggest,
  onPosted,
  linkRequest,
  zoom,
  pdfDigest,
}: {
  editor: Editor | null
  artboard: RefObject<HTMLElement | null>
  pdfSelection: PdfSelection | undefined
  writable: boolean
  busy: boolean
  error: string
  onComment: (target: ReviewTarget, text: string, requestId: string) => Promise<unknown>
  onAnnotate: (selection: PdfSelection, tool: PdfTextMarkTool, requestIds: readonly string[]) => Promise<boolean>
  annotationSlots: number
  onSuggest: (target: ReviewTarget) => void
  onPosted: () => void
  linkRequest: number
  zoom: string
  pdfDigest: string
}) {
  const compact = useMediaQuery('(max-width: 640px)')
  const condensed = useMediaQuery('(max-width: 760px)')
  const layer = useLayer({ mode: 'fixed' })
  const [target, setTarget] = useState<ReviewTarget>()
  const [mode, setMode] = useState<Mode>('toolbar')
  const [visible, setVisible] = useState(false)
  const [selectionVersion, setSelectionVersion] = useState(0)
  const [text, setText] = useState('')
  const [href, setHref] = useState('')
  const [linkError, setLinkError] = useState('')
  const [annotationError, setAnnotationError] = useState('')
  const [annotating, setAnnotating] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const range = useRef<Range>(null)
  const surface = useRef<HTMLElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const linkInput = useRef<HTMLInputElement>(null)
  const retry = useRef({ body: '', id: '' })
  const annotationRetry = useRef<{ body: string; ids: string[] }>({ body: '', ids: [] })
  const sending = useRef(false)
  const dismissed = useRef('')
  const drafting = useRef(false)
  drafting.current = (mode !== 'toolbar' || annotating) && visible
  const pdf = useRef(pdfSelection)
  pdf.current = pdfSelection
  const lastLinkRequest = useRef(linkRequest)
  useEffect(() => {
    if (linkRequest === lastLinkRequest.current) {
      return
    }
    lastLinkRequest.current = linkRequest
    if (!editor || !writable) {
      return
    }
    const anchor = nativeSelection(editor)
    setTarget(anchor ? { kind: 'native', anchor } : undefined)
    const value: unknown = editor.getAttributes('link')['href']
    setHref(typeof value === 'string' ? value : '')
    setMode('link')
    setLinkError('')
    setVisible(true)
  }, [linkRequest, editor, writable])

  useEffect(() => {
    const capture = (event?: Event) => {
      if (event instanceof KeyboardEvent && event.key === 'Escape') {
        return
      }
      if (event instanceof KeyboardEvent && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        dismissed.current = ''
      }
      if (event && event.type !== 'selectionchange' && event.target instanceof Node && !artboard.current?.contains(event.target)) {
        return
      }
      if (drafting.current) {
        return
      }
      if (!writable) {
        setVisible(false)
        return
      }
      let selected: Range
      let quote: string
      let anchor: NativeAnchor | undefined
      const selectedPdf = pdf.current
      if (editor) {
        const { from, to, empty } = editor.state.selection
        if (empty) {
          setVisible(false)
          return
        }
        // The editor model owns native selection. DOM selection can briefly lag
        // during responsive reparenting and popover focus transitions.
        const start = editor.view.domAtPos(from)
        const end = editor.view.domAtPos(to)
        selected = window.document.createRange()
        selected.setStart(start.node, start.offset)
        selected.setEnd(end.node, end.offset)
        quote = editor.state.doc.textBetween(from, to, '\n')
        anchor = nativeSelection(editor)
      } else {
        const selection = window.getSelection()
        if (!selection?.rangeCount || selection.isCollapsed) {
          setVisible(false)
          return
        }
        selected = selection.getRangeAt(0)
        quote = selection.toString().trim()
        if (!selectedPdf || selectedPdf.quote !== quote) {
          return
        }
      }
      if (!artboard.current?.contains(selected.commonAncestorContainer)) {
        return
      }
      if (quote === dismissed.current) {
        return
      }
      dismissed.current = ''
      if (!quote.trim()) {
        setVisible(false)
        return
      }
      range.current = selected.cloneRange()
      setSelectionVersion((value) => value + 1)
      setTarget(anchor ? { kind: 'native', anchor } : selectedPdf && quote.length <= 800 ? { kind: 'pdf', selection: selectedPdf } : undefined)
      setMode('toolbar')
      setVisible(true)
    }
    window.document.addEventListener('selectionchange', capture)
    const startSelection = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) {
        return
      }
      if (artboard.current?.contains(event.target)) {
        dismissed.current = ''
        setAnnotationError('')
        return
      }
      if (!drafting.current && !surface.current?.contains(event.target) && !event.target.closest('[role="menu"], [role="dialog"]')) {
        setVisible(false)
      }
    }
    window.document.addEventListener('pointerdown', startSelection)
    window.document.addEventListener('pointerup', capture)
    window.document.addEventListener('keyup', capture)
    const syncEditor = () => capture()
    editor?.on('selectionUpdate', syncEditor)
    capture()
    return () => {
      window.document.removeEventListener('selectionchange', capture)
      window.document.removeEventListener('pointerdown', startSelection)
      window.document.removeEventListener('pointerup', capture)
      window.document.removeEventListener('keyup', capture)
      editor?.off('selectionUpdate', syncEditor)
    }
  }, [editor, artboard, writable, pdfSelection])

  useEffect(() => {
    if (!visible || !writable) {
      layer.hide()
      return
    }
    if (!(compact && mode !== 'toolbar')) {
      layer.show()
    }
    const place = () => {
      const bounds = range.current?.getBoundingClientRect() ?? (editor ? editor.view.coordsAtPos(editor.state.selection.from) : undefined)
      if (!bounds) {
        return
      }
      const width = surface.current?.offsetWidth ?? (mode === 'toolbar' ? 400 : 336)
      const height = surface.current?.offsetHeight ?? 44
      const viewport = window.visualViewport
      const bottom = (viewport?.height ?? window.innerHeight) + (viewport?.offsetTop ?? 0)
      const x = Math.max(8, Math.min((bounds.left + bounds.right) / 2 - width / 2, window.innerWidth - width - 8))
      const y = Math.max(44, Math.min(bounds.top - height - 8 >= 44 ? bounds.top - height - 8 : bounds.bottom + 8, bottom - height - 8))
      setPosition((old) => (old.x === x && old.y === y ? old : { x, y }))
    }
    const observer = new ResizeObserver(place)
    if (surface.current) {
      observer.observe(surface.current)
    }
    if (artboard.current) {
      observer.observe(artboard.current)
    }
    if (artboard.current?.parentElement) {
      observer.observe(artboard.current.parentElement)
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    window.visualViewport?.addEventListener('resize', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('resize', place)
    }
  }, [visible, mode, compact, writable, layer.show, layer.hide, artboard, editor, zoom, selectionVersion])

  useEffect(() => {
    if (mode === 'toolbar' && target?.kind === 'pdf' && target.selection.digest !== pdfDigest) {
      setVisible(false)
    }
  }, [pdfDigest, mode, target])

  function restore() {
    if (!target && editor) {
      editor.commands.focus()
      return true
    }
    if (target?.kind === 'native' && editor) {
      return locateNative(editor, target.anchor)
    }
    if (range.current?.startContainer.isConnected) {
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range.current)
      artboard.current?.focus()
      return true
    }
    return false
  }
  function close() {
    dismissed.current = target?.kind === 'native' ? target.anchor.quote : (target?.selection.quote ?? '')
    setVisible(false)
    restore()
  }
  function format(action: (editor: Editor) => void) {
    if (editor && (target ? restore() : true)) {
      action(editor)
    }
  }
  useEffect(() => {
    if (!visible) {
      return
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [visible, target, editor])
  useEffect(() => {
    if (visible && mode === 'comment') {
      input.current?.focus()
    }
    if (visible && mode === 'link') {
      linkInput.current?.focus()
    }
    if (visible && mode !== 'toolbar' && range.current && typeof Highlight !== 'undefined') {
      CSS.highlights.set('clausid-passage', new Highlight(range.current))
    }
    return () => {
      CSS.highlights?.delete('clausid-passage')
    }
  }, [visible, mode])
  async function post() {
    if (!target || !text.trim() || busy || sending.current || !writable) {
      return
    }
    const body = JSON.stringify({ target, text })
    if (retry.current.body !== body) {
      retry.current = { body, id: crypto.randomUUID() }
    }
    sending.current = true
    try {
      if (await onComment(target, text, retry.current.id)) {
        dismissed.current = target.kind === 'native' ? target.anchor.quote : target.selection.quote
        setText('')
        retry.current = { body: '', id: '' }
        setVisible(false)
        onPosted()
      }
    } finally {
      sending.current = false
    }
  }
  async function annotate(tool: PdfTextMarkTool) {
    if (target?.kind !== 'pdf' || !target.selection.marks?.length || !writable || busy || sending.current) {
      return
    }
    const body = JSON.stringify({ selection: target.selection, tool })
    if (annotationRetry.current.body !== body) {
      if (target.selection.marks.length > annotationSlots) {
        setAnnotationError('Not enough annotation slots for this selection. Choose fewer lines.')
        return
      }
      annotationRetry.current = { body, ids: target.selection.marks.map(() => crypto.randomUUID()) }
    }
    sending.current = true
    setAnnotating(true)
    setAnnotationError('')
    try {
      if (await onAnnotate(target.selection, tool, annotationRetry.current.ids)) {
        dismissed.current = target.selection.quote
        annotationRetry.current = { body: '', ids: [] }
        setVisible(false)
        onPosted()
      } else {
        setAnnotationError('Some lines may already be saved. Retry this action to finish without duplicates.')
      }
    } finally {
      sending.current = false
      setAnnotating(false)
    }
  }
  const native = Boolean(editor)
  const markButtons = [
    ['Bold', Bold, (e: Editor) => e.chain().focus().toggleBold().run(), 'bold'],
    ['Italic', Italic, (e: Editor) => e.chain().focus().toggleItalic().run(), 'italic'],
    ['Underline', Underline, (e: Editor) => e.chain().focus().toggleUnderline().run(), 'underline'],
    ['Strikethrough', Strikethrough, (e: Editor) => e.chain().focus().toggleStrike().run(), 'strike'],
  ] as const
  const blockButtons = [
    ['Bulleted list', List, (e: Editor) => e.chain().focus().toggleBulletList().run(), 'bulletList'],
    ['Numbered list', ListOrdered, (e: Editor) => e.chain().focus().toggleOrderedList().run(), 'orderedList'],
    ['Blockquote', Quote, (e: Editor) => e.chain().focus().toggleBlockquote().run(), 'blockquote'],
  ] as const
  const extra = (
    <>
      {markButtons.map(([label, _icon, action, mark]) => (
        <DropdownMenuItem key={label} label={label} onClick={() => format(action)} endContent={editor?.isActive(mark) ? <Text>✓</Text> : undefined} />
      ))}
      <DropdownMenuItem label="Bulleted list" onClick={() => format((e) => e.chain().focus().toggleBulletList().run())} />
      <DropdownMenuItem label="Numbered list" onClick={() => format((e) => e.chain().focus().toggleOrderedList().run())} />
      <DropdownMenuItem label="Blockquote" onClick={() => format((e) => e.chain().focus().toggleBlockquote().run())} />
    </>
  )
  function openLink() {
    const value: unknown = editor?.getAttributes('link')['href']
    setHref(typeof value === 'string' ? value : '')
    setLinkError('')
    setMode('link')
  }
  const colorItems = (
    <>
      <DropdownMenuItem label="Default color" onClick={() => format((e) => e.chain().focus().unsetColor().run())} />
      {nativeTextColors.map((color) => (
        <DropdownMenuItem
          key={color.value}
          label={color.name}
          onClick={() => format((e) => e.chain().focus().setColor(color.value).run())}
          endContent={editor?.isActive('textStyle', { color: color.value }) ? <Text>✓</Text> : undefined}
        />
      ))}
    </>
  )
  const quote = target?.kind === 'native' ? target.anchor.quote : target?.selection.quote
  const body = (
    <VStack
      ref={surface}
      gap={2}
      padding={mode === 'toolbar' ? 1 : 3}
      xstyle={[styles.surface, mode !== 'toolbar' && styles.composer, compact && mode !== 'toolbar' && styles.compactComposer]}
      role={mode === 'toolbar' || compact ? undefined : 'dialog'}
      aria-label={mode === 'comment' ? 'Comment on passage' : mode === 'link' ? 'Edit link' : undefined}
      onPointerDown={(event) => {
        if (mode === 'toolbar') {
          event.preventDefault()
        }
      }}
    >
      {mode === 'toolbar' ? (
        <Toolbar
          label="Selection tools"
          size="sm"
          startContent={
            <>
              {native && !condensed && (
                <DropdownMenu button={{ label: 'Text', size: 'sm', variant: 'ghost' }}>
                  <DropdownMenuItem label="Paragraph" onClick={() => format((e) => e.chain().focus().setParagraph().run())} />
                  {([1, 2, 3] as const).map((level) => (
                    <DropdownMenuItem key={level} label={'Heading ' + level} onClick={() => format((e) => e.chain().focus().setHeading({ level }).run())} />
                  ))}
                </DropdownMenu>
              )}
              <Button
                label="Comment"
                isDisabled={!target}
                size="sm"
                variant="ghost"
                icon={<Icon icon={MessageSquare} size="sm" />}
                onClick={() => setMode('comment')}
              />
              {native &&
                !condensed &&
                markButtons.map(([label, icon, action, mark]) => (
                  <IconButton
                    key={label}
                    label={label}
                    tooltip={label}
                    icon={<Icon icon={icon} size="sm" />}
                    variant={editor?.isActive(mark) ? 'secondary' : 'ghost'}
                    aria-pressed={editor?.isActive(mark) ?? false}
                    onClick={() => format(action)}
                  />
                ))}
              {native &&
                !condensed &&
                blockButtons.map(([label, icon, action, mark]) => (
                  <IconButton
                    key={label}
                    label={label}
                    tooltip={label}
                    icon={<Icon icon={icon} size="sm" />}
                    variant={editor?.isActive(mark) ? 'secondary' : 'ghost'}
                    aria-pressed={editor?.isActive(mark) ?? false}
                    onClick={() => format(action)}
                  />
                ))}
              {!native &&
                (
                  [
                    ['Highlight', Highlighter, 'highlight'],
                    ['Underline', Underline, 'underline'],
                    ['Strikethrough', Strikethrough, 'strikethrough'],
                  ] as const
                ).map(([label, icon, tool]) => (
                  <IconButton
                    key={tool}
                    label={label}
                    tooltip={label}
                    icon={<Icon icon={icon} size="sm" />}
                    variant="ghost"
                    isDisabled={busy || annotating || target?.kind !== 'pdf' || !target.selection.marks?.length}
                    onClick={() => void annotate(tool)}
                  />
                ))}
              {native && condensed && (
                <DropdownMenu
                  button={{
                    label: 'More formatting',
                    tooltip: 'More formatting',
                    isIconOnly: true,
                    icon: <Icon icon={Ellipsis} size="sm" />,
                    size: 'sm',
                    variant: 'ghost',
                  }}
                  hasChevron={false}
                >
                  {condensed && (
                    <>
                      <DropdownMenuItem label="Paragraph" onClick={() => format((e) => e.chain().focus().setParagraph().run())} />
                      {([1, 2, 3] as const).map((level) => (
                        <DropdownMenuItem key={level} label={'Heading ' + level} onClick={() => format((e) => e.chain().focus().setHeading({ level }).run())} />
                      ))}
                    </>
                  )}
                  {extra}
                  {condensed && (
                    <>
                      <DropdownMenuSubMenu label="Text color">{colorItems}</DropdownMenuSubMenu>
                      <DropdownMenuItem label="Link" onClick={openLink} />
                    </>
                  )}
                </DropdownMenu>
              )}
              {native && !condensed && (
                <>
                  <DropdownMenu button={{ label: 'Text color', tooltip: 'Text color', size: 'sm', variant: 'ghost' }}>{colorItems}</DropdownMenu>
                  <IconButton label="Link" tooltip="Link" variant="ghost" icon={<Icon icon={Link} size="sm" />} onClick={openLink} />
                </>
              )}
              <IconButton
                label="Suggest replacement"
                isDisabled={!target}
                tooltip="Suggest replacement"
                variant="ghost"
                icon={<Icon icon={Replace} size="sm" />}
                onClick={() => {
                  if (target) {
                    onSuggest(target)
                    setVisible(false)
                  }
                }}
              />
            </>
          }
        />
      ) : (
        <>
          {!compact && (
            <HStack vAlign="center">
              <Text weight="semibold">{mode === 'comment' ? 'Comment' : 'Link'}</Text>
              <IconButton label="Cancel" variant="ghost" size="sm" icon={<Icon icon={X} size="sm" />} onClick={close} />
            </HStack>
          )}
          <Text type="supporting" color="secondary" xstyle={styles.quote}>
            {quote}
          </Text>
          {mode === 'comment' ? (
            <>
              <TextArea
                ref={input}
                label="Comment"
                placeholder="Add a comment…"
                value={text}
                onChange={setText}
                maxLength={800}
                rows={3}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault()
                    void post()
                  }
                }}
              />
              {error && (
                <Text role="alert" color="primary">
                  {error}
                </Text>
              )}
              <HStack hAlign="end">
                <Button
                  label="Post comment"
                  variant="primary"
                  isLoading={busy}
                  isDisabled={!writable || busy || !text.trim()}
                  endContent={<Icon icon={ArrowUp} size="sm" />}
                  onClick={() => void post()}
                />
              </HStack>
            </>
          ) : (
            <>
              <TextInput ref={linkInput} label="Link URL" placeholder="https://example.com" value={href} onChange={setHref} />
              {linkError && <Text role="alert">{linkError}</Text>}
              <HStack gap={2} wrap="wrap">
                <Button
                  label="Apply link"
                  variant="primary"
                  onClick={() => {
                    const result = nativeLinkSchema.safeParse(href.trim())
                    if (!result.success) {
                      setLinkError('Enter an absolute http, https or mailto link.')
                      return
                    }
                    format((e) => e.chain().focus().extendMarkRange('link').setLink({ href: result.data }).run())
                    setMode('toolbar')
                  }}
                />
                <Button
                  label="Remove link"
                  onClick={() => {
                    format((e) => e.chain().focus().extendMarkRange('link').unsetLink().run())
                    setMode('toolbar')
                  }}
                />
                {nativeLinkSchema.safeParse(href).success && <Button label="Open link" href={href} target="_blank" rel="noopener noreferrer" variant="ghost" />}
              </HStack>
            </>
          )}
        </>
      )}
      {mode === 'toolbar' && annotationError && (
        <Text role="alert">
          {annotationError} {error}
        </Text>
      )}
    </VStack>
  )
  return (
    <>
      {!(compact && mode !== 'toolbar') && layer.render(body, { x: position.x, y: position.y })}
      {compact && mode !== 'toolbar' && visible && (
        <Drawer
          isOpen
          onOpenChange={(open) => {
            if (!open) {
              close()
            }
          }}
          side="end"
          width={360}
          label={mode === 'comment' ? 'Comment on passage' : 'Edit link'}
        >
          <DrawerHeader title={mode === 'comment' ? 'Comment' : 'Link'} onOpenChange={close} />
          {body}
        </Drawer>
      )}
    </>
  )
}
