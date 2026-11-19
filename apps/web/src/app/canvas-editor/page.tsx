// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client'
import { definedProps } from '../../defined-props.ts'

import { requiredValue } from '../../../../../packages/contracts/src/invariant.ts'

import type { MarkupControls } from './pdf-markup.tsx'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as stylex from '@stylexjs/stylex'

import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import type { Doc } from 'yjs'
import type { Awareness } from 'y-protocols/awareness'
import { Card } from '@astryxdesign/core/Card'
import { Center } from '@astryxdesign/core/Center'
import { Divider } from '@astryxdesign/core/Divider'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuDivider,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSubMenu,
} from '@astryxdesign/core/DropdownMenu'
import { Icon, type IconType } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Item } from '@astryxdesign/core/Item'
import { HStack, Layout, LayoutContent, LayoutPanel, StackItem, VStack } from '@astryxdesign/core/Layout'
import { ResizeHandle, useResizable } from '@astryxdesign/core/Resizable'
import { Section } from '@astryxdesign/core/Section'
import { Selector } from '@astryxdesign/core/Selector'
import { Text } from '@astryxdesign/core/Text'
import { useContainerReveal, useMediaQuery } from '@astryxdesign/core/hooks'
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden'
import { Theme } from '@astryxdesign/core/theme'
import { Toolbar } from '@astryxdesign/core/Toolbar'
import { neutralTheme } from '@astryxdesign/theme-neutral/built'
import {
  BookOpen,
  ListTree,
  Users,
  Menu,
  PenTool,
  MousePointer2,
  Brush,
  Highlighter,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Undo2,
  Redo2,
  Type,
  MessageSquare,
  Replace,
  Signature,
  Download,
  PanelLeft,
  PanelRight,
  PanelTop,
  X,
  File as FileIcon,
} from 'lucide-react'
import { Drawer, DrawerHeader } from '@astryxdesign/core/Drawer'
import { Button } from '@astryxdesign/core/Button'
import { Banner } from '@astryxdesign/core/Banner'
import { Heading } from '@astryxdesign/core/Heading'
import { PdfAnnotations } from '../../pdf-annotations.tsx'
import { NativeReview } from './native-review.tsx'
import { DocumentNavigation } from './document-navigation.tsx'
import { locateNative, nativePosition, nativeSelection, PdfNavigation, type PdfSelection, type Passage } from './navigation.ts'
import type { ContractView, NativeAnchor } from '@clausid/contracts'

const TAB_MAX_WIDTH = 164
const ICON = 'sm' as const
type ThemeMode = 'light' | 'dark' | 'system'
type Left = 'Sections' | 'Index'
type Right = 'Comments' | 'Suggestions' | 'People'
const toolsLeft = [
  ['Sections', ListTree],
  ['Index', BookOpen],
] as const
const toolsRight = [
  ['Comments', MessageSquare],
  ['Suggestions', Replace],
  ['People', Users],
] as const
const styles = stylex.create({
  canvasStage: { minWidth: '100%' },
  artboardCentered: (zoom: number) => ({ margin: 'auto', zoom }),
  headerTools: { overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none' },
  toolBarRule: { alignSelf: 'stretch', height: 'auto', marginBlock: 'var(--spacing-1)' },
  headerLead: { minWidth: 0 },
  itemAction: {
    margin: 'calc(-1 * var(--spacing-1))',
    color: {
      default: 'var(--color-icon-secondary)',
      ':hover': 'var(--color-icon-primary)',
      ':disabled': 'var(--color-icon-disabled)',
    },
  },
  tabStrip: { minWidth: 0, flexShrink: 1, scrollbarWidth: 'none' },
  tab: {
    gap: 'var(--spacing-1-5)',
    paddingInlineEnd: 'var(--spacing-1)',
    flexGrow: 0,
    flexShrink: 1,
    width: TAB_MAX_WIDTH,
    minWidth: 96,
  },
  tabSelected: { backgroundColor: 'var(--color-background-muted)' },
  tabHover: {
    backgroundColor: {
      default: 'transparent',
      ':hover': 'var(--color-background-muted)',
    },
  },
})
const ZOOM_OPTIONS = [
  { value: '0.25', label: '25%' },
  { value: '0.4', label: '40%' },
  { value: '0.6', label: '60%' },
  { value: '1', label: '100%' },
]

function Shortcut({ children }: { children: string }) {
  return (
    <Text type="supporting" color="secondary">
      {children}
    </Text>
  )
}

export type CanvasHeader = {
  start: React.ReactNode
  tools: React.ReactNode
  end: React.ReactNode
  stackedTools: boolean
}

interface DocumentTabData {
  id: string
  name: string
  icon: IconType
}
function ItemAction({
  label,
  icon,
  isDisabled,
  onClick,
  xstyle,
  className,
  style,
}: {
  label: string
  icon: IconType
  isDisabled?: boolean
  onClick?: () => void
  xstyle?: stylex.StyleXStyles
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <IconButton
      label={label}
      icon={<Icon icon={icon} size={ICON} />}
      variant="ghost"
      size="sm"
      {...definedProps({ isDisabled: isDisabled })}
      {...definedProps({ onClick: onClick })}
      xstyle={[styles.itemAction, xstyle]}
      className={className}
      style={style}
    />
  )
}

function DocumentTab({ tab, isActive, onSelect, onClose }: { tab: DocumentTabData; isActive: boolean; onSelect: () => void; onClose: () => void }) {
  const { getContainerProps, getContentRevealProps } = useContainerReveal()

  return (
    <Item
      label={tab.name}
      density="compact"
      style={{ paddingBlock: 0 }}
      isSelected={isActive}
      onClick={onSelect}
      aria-current={isActive ? 'true' : undefined}
      {...getContainerProps()}
      startContent={<Icon icon={tab.icon} size={ICON} color={isActive ? 'primary' : 'secondary'} />}
      endContent={
        <ItemAction
          label={`Close ${tab.name}`}
          icon={X}
          onClick={onClose}
          {...getContentRevealProps({
            ...(isActive ? { forceVisibility: 'shown' as const } : {}),
          })}
        />
      }
      xstyle={[styles.tab, isActive ? styles.tabSelected : styles.tabHover]}
    />
  )
}

function CanvasDocumentTab({ title, compact, onSelect }: { title: string; compact: boolean; onSelect: () => void }) {
  return (
    <HStack
      role="group"
      aria-label="Open documents"
      gap={0}
      vAlign="center"
      paddingInline={compact ? 0 : 2}
      paddingBlock={0.5}
      isScrollable
      maxWidth={compact ? 96 : TAB_MAX_WIDTH}
      xstyle={styles.tabStrip}
    >
      <DocumentTab tab={{ id: 'contract', name: title, icon: FileIcon }} isActive onSelect={onSelect} onClose={() => location.assign('/')} />
    </HStack>
  )
}

export function EmptyCanvas({ member }: { member: boolean }) {
  return (
    <Section variant="muted" height="100%" padding={4} role="region" aria-label="Canvas">
      <Center height="100%">
        <EmptyState
          title="No contracts yet"
          description={member ? 'Contracts appear here when the service provider shares them.' : 'Use Add document to start a contract.'}
        />
      </Center>
    </Section>
  )
}

type LiveDocument = {
  renderShell: (content: React.ReactNode, header: CanvasHeader) => React.ReactNode
  title: string
  document: Doc
  awareness: Awareness
  name: string
  editable: boolean
  syncStatus?: string
  frozen?: { pdf: React.ReactNode; exportActions: React.ReactNode }
  contract: ContractView
  email: string
  busy: boolean
  error: string
  mutate: (action: string, body: object) => Promise<unknown>
  onShare?: () => void
  markup?: MarkupControls
  signatureAction: { label: string; open?: (() => void) | undefined }
  onAccountSettings: () => void
}

export default function CanvasEditor({
  title,
  document,
  awareness,
  name,
  editable,
  syncStatus,
  frozen,
  contract,
  email,
  busy,
  error,
  mutate,
  onShare,
  signatureAction,
  markup,
  onAccountSettings,
  renderShell,
}: LiveDocument) {
  const narrow = useMediaQuery('(max-width: 900px)')
  const compactHeader = useMediaQuery('(max-width: 640px)')
  const artboard = useRef<HTMLElement>(null)
  const contractEditor = useEditor(
    {
      extensions: [
        StarterKit.configure({ link: false, undoRedo: false, trailingNode: false }),
        Collaboration.configure({ document }),
        CollaborationCaret.configure({ provider: { awareness }, user: { name, color: '#246a59' } }),
      ],
      editorProps: { attributes: { 'aria-label': 'Contract document', role: 'textbox', 'aria-multiline': 'true' } },
      editable: editable,
    },
    [document, awareness, name],
  )
  useEffect(() => {
    contractEditor?.setEditable(editable)
  }, [contractEditor, editable])
  const marks = useEditorState({
    editor: contractEditor,
    selector: ({ editor }) => ({
      bold: editor?.isActive('bold'),
      italic: editor?.isActive('italic'),
      underline: editor?.isActive('underline'),
      strike: editor?.isActive('strike'),
    }),
  })

  const [zoom, setZoom] = useState('1')
  const scale = Number(zoom)
  const [chrome, setChrome] = useState({ toolbar: true })
  const [appearance, setAppearance] = useState<ThemeMode>('system')
  const [left, setLeft] = useState<Left | null>(() => (narrow ? null : 'Sections'))
  const [right, setRight] = useState<Right | null>(null)
  useEffect(() => {
    setLeft(narrow ? null : 'Sections')
    setRight(null)
  }, [narrow])
  const [pdfRows, setPdfRows] = useState<Passage[]>([])
  const [selectedPdf, setSelectedPdf] = useState<PdfSelection>()
  const [anchor, setAnchor] = useState<NativeAnchor>()
  const [current, setCurrent] = useState<Passage>()
  const [notice, setNotice] = useState('')
  const lastPage = useRef(1)
  const rail = useResizable({ defaultSize: 232, minSize: 176, maxSize: 320 })
  const inspector = useResizable({ defaultSize: 320, minSize: 264, maxSize: 440 })
  const digest = contract.version?.digest ?? contract.negotiatedPdf?.digest ?? contract.sourcePdf?.digest ?? ''
  const [online, setOnline] = useState<string[]>([])
  useEffect(() => {
    const sync = () =>
      setOnline(
        [...awareness.getStates().values()].flatMap((state: unknown) => {
          const user: unknown = state && typeof state === 'object' ? Reflect.get(state, 'user') : undefined
          const email: unknown = user && typeof user === 'object' ? Reflect.get(user, 'email') : undefined
          return typeof email === 'string' ? [email] : []
        }),
      )
    sync()
    awareness.on('change', sync)
    return () => awareness.off('change', sync)
  }, [awareness])
  const content = useEditorState({ editor: contractEditor, selector: ({ editor }) => editor?.state.doc })
  const showingPdf = Boolean(frozen)
  const nativeRows = useMemo(() => {
    const rows: Passage[] = []
    if (showingPdf || !contractEditor || !content) {
      return rows
    }
    content.descendants((node, position) => {
      if (node.isTextblock && node.textContent.trim()) {
        rows.push({
          key: nativePosition(contractEditor, position + 1),
          position: position + 1,
          text: node.textContent,
          ...(node.type.name === 'heading' && typeof node.attrs['level'] === 'number' ? { level: Number(node.attrs['level']) } : {}),
        })
      }
    })
    return rows
  }, [content, contractEditor, showingPdf])
  useEffect(() => {
    if (showingPdf || !contractEditor) {
      return
    }
    function trackSelection() {
      if (!contractEditor) {
        return
      }
      const selection = nativeSelection(contractEditor)
      setAnchor(selection)
      const pos = contractEditor.state.selection.from
      const row = nativeRows.find((line) => requiredValue(line.position) <= pos && requiredValue(line.position) + line.text.length >= pos)
      setCurrent(row ?? nativeRows[0])
    }
    trackSelection()
    contractEditor.on('selectionUpdate', trackSelection)
    contractEditor.on('focus', trackSelection)
    return () => {
      contractEditor.off('selectionUpdate', trackSelection)
      contractEditor.off('focus', trackSelection)
    }
  }, [contractEditor, nativeRows, showingPdf])
  const rows = frozen ? pdfRows : nativeRows
  useEffect(() => {
    const article = artboard.current
    if (!article) {
      return
    }
    let parent = article.parentElement
    while (parent && !['auto', 'scroll'].includes(getComputedStyle(parent).overflowY)) {
      parent = parent.parentElement
    }
    if (!parent) {
      return
    }
    const viewport = parent
    let pending = 0
    function track() {
      pending = 0
      const top = viewport.getBoundingClientRect().top + 32
      if (showingPdf) {
        const pages = [...requiredValue(article).querySelectorAll<HTMLElement>('[id^="contract-pdf-page-"]')]
        const active = pages.find((page) => page.getBoundingClientRect().bottom > top)
        if (active) {
          const page = Number(active.id.replace('contract-pdf-page-', ''))
          lastPage.current = page
          const items = [...active.querySelectorAll<HTMLElement>('[data-pdf-item]')]
          const first = items.find((item) => item.getBoundingClientRect().bottom > top)
          const row = rows.find((line) => line.page === page && line.item === (first ? Number(first['dataset']['pdfLine']) : undefined))
          if (row) {
            setCurrent(row)
          }
        }
      } else if (contractEditor) {
        const bounds = viewport.getBoundingClientRect()
        const pos = contractEditor.view.posAtCoords({ left: (bounds.left + bounds.right) / 2, top })?.pos
        if (pos !== undefined) {
          setCurrent(rows.findLast((row) => requiredValue(row.position) <= pos))
        }
      }
    }
    const onScroll = () => {
      if (!pending) {
        pending = requestAnimationFrame(track)
      }
    }
    viewport.addEventListener('scroll', onScroll)
    return () => {
      viewport.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(pending)
    }
  }, [rows, showingPdf, contractEditor])
  function chooseLeft(next: Left | null) {
    if (narrow && next) {
      setRight(null)
    }
    setLeft(next)
  }
  function chooseRight(next: Right | null) {
    if (narrow && next) {
      setLeft(null)
    }
    setRight(next)
    setNotice('')
    if (contractEditor && !frozen) {
      setAnchor(nativeSelection(contractEditor))
    }
  }
  const writable = contract.status === 'Draft' && contract.role !== 'signer'
  const canReview = contract.role !== 'signer'
  const onAnnotations = canReview ? () => chooseRight('Comments') : undefined
  const onReplaceText = writable ? () => chooseRight('Suggestions') : undefined
  const onSelectPdf = (selection: PdfSelection) => {
    lastPage.current = selection.page
    setSelectedPdf(selection)
    const matching = rows.filter((row) => row.page === selection.page && row.item !== undefined && row.text.includes(selection.quote))
    setCurrent(matching.length === 1 ? matching[0] : rows.find((row) => row.key === 'page-' + selection.page))
    chooseRight(selection.singleLine ? 'Suggestions' : 'Comments')
  }
  const loadPdf = useCallback((next: Passage[]) => {
    setPdfRows(next)
    if (lastPage.current > 1) {
      window.document.getElementById('contract-pdf-page-' + lastPage.current)?.scrollIntoView({ block: 'start' })
    }
  }, [])
  const jumpObserver = useRef<MutationObserver | null>(null)
  useEffect(() => () => jumpObserver.current?.disconnect(), [])
  function visit(row: Passage) {
    if (narrow) {
      setLeft(null)
      setRight(null)
    }
    setCurrent(row)
    if (row.position !== undefined && contractEditor) {
      const from = row.position + (row.offset ?? 0)
      contractEditor
        .chain()
        .focus()
        .setTextSelection({ from, to: from + row.text.length })
        .scrollIntoView()
        .run()
      return
    }
    if (!row.page) {
      return
    }
    lastPage.current = row.page
    const sheet = window.document.getElementById('contract-pdf-page-' + row.page)
    sheet?.scrollIntoView({ block: 'start' })
    jumpObserver.current?.disconnect()
    if (!sheet || row.item === undefined) {
      return
    }
    const highlight = () => {
      const spans = [...sheet.querySelectorAll<HTMLElement>('[data-pdf-line="' + row.item + '"]')]
      const start = row.offset ?? 0
      const end = start + row.text.length
      const first = spans.find((span) => Number(span['dataset']['offset']) + (span.textContent?.length ?? 0) > start)
      const last = spans.find((span) => Number(span['dataset']['offset']) + (span.textContent?.length ?? 0) >= end)
      if (!first?.firstChild || !last?.firstChild) {
        return false
      }
      const range = window.document.createRange()
      range.setStart(first.firstChild, start - Number(first['dataset']['offset']))
      range.setEnd(last.firstChild, end - Number(last['dataset']['offset']))
      if (range.toString() !== row.text) {
        return false
      }
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
      first.scrollIntoView({ block: 'center' })
      return true
    }
    if (!highlight()) {
      const observer = new MutationObserver(() => {
        if (highlight()) {
          observer.disconnect()
        }
      })
      jumpObserver.current = observer
      observer.observe(sheet, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-pdf-item'] })
    }
  }
  const saveReview = (change: import('@clausid/contracts').ReviewChange, requestId: string) => mutate('review', { change, requestId })
  const navigation = left && (
    <DocumentNavigation
      key={left}
      mode={left}
      passages={rows}
      corrections={contract.outline ?? []}
      writable={writable}
      {...definedProps({ current: current })}
      visit={visit}
      save={saveReview}
    />
  )
  const openCount = contract.sourcePdf
    ? markup?.annotations.filter((item) => item.edit && !item.decision && !item.withdrawn).length
    : contract.threads?.filter((item) => item.replacement !== undefined && !item.decision).length
  const review =
    right === 'People' ? (
      <VStack gap={2}>
        {contract.team?.map((person) => (
          <VStack key={person.id} gap={0.5}>
            <Text weight="semibold">{person.email}</Text>
            <Text type="supporting">
              {person.id === contract.owner?.id ? 'Provider' : contract.editors.some((item) => item.id === person.id) ? 'Editor' : 'Signer'}
              {online.includes(person.email) || (person.email === email && syncStatus === 'Saved') ? ' · Online' : ''}
            </Text>
          </VStack>
        ))}
        {onShare && <Button label="Share contract" onClick={onShare} />}
      </VStack>
    ) : (
      canReview &&
      right && (
        <VStack gap={2}>
          {notice && <Text role="status">{notice}</Text>}
          {contract.sourcePdf ? (
            <PdfAnnotations
              key={right + JSON.stringify(selectedPdf)}
              contract={contract}
              propose={right === 'Suggestions'}
              {...definedProps({ selection: selectedPdf })}
              save={(change) => mutate('annotation', change)}
              error={error}
              busy={busy}
              visit={(page, quote, location) => {
                const matches = quote
                  ? rows.filter(
                      (row) =>
                        row.item !== undefined &&
                        row.page === page &&
                        row.text.includes(quote) &&
                        (location
                          ? row.x === location.x && row.y === location.y && row.text.startsWith(quote, location.offset)
                          : row.text.indexOf(quote) === row.text.lastIndexOf(quote)),
                    )
                  : []
                if (quote && matches.length !== 1) {
                  setNotice('Passage unavailable on the current page: ' + quote)
                }
                visit(
                  matches.length === 1 && quote
                    ? { ...requiredValue(matches[0]), offset: location?.offset ?? requiredValue(matches[0]).text.indexOf(quote), text: quote }
                    : { key: 'page-' + page, page, text: '' },
                )
              }}
            />
          ) : (
            <>
              {error && <Banner status="error" title={error} />}
              <NativeReview
                key={right}
                contract={contract}
                suggest={right === 'Suggestions'}
                email={email}
                save={saveReview}
                busy={busy}
                {...definedProps({ anchor: anchor })}
                visit={(location) => {
                  if (!contractEditor || !locateNative(contractEditor, location)) {
                    setNotice('This passage is no longer available.')
                  }
                }}
              />
            </>
          )}
        </VStack>
      )
    )

  const header: CanvasHeader = {
    stackedTools: narrow,
    start: (
      <HStack gap={0.5} vAlign="center" xstyle={styles.headerLead}>
        <DropdownMenu
          button={{
            label: 'Menu',
            tooltip: 'Menu',
            variant: 'ghost',
            size: 'sm',
            isIconOnly: true,
            icon: <Icon icon={Menu} size={ICON} />,
          }}
          hasChevron={false}
          menuWidth={280}
        >
          <DropdownMenuSubMenu label="File">
            <DropdownMenuItem label="Back to contracts" href="/" />
            <DropdownMenuItem label="Account settings" onClick={onAccountSettings} />
          </DropdownMenuSubMenu>

          <DropdownMenuSubMenu label="Edit">
            <DropdownMenuItem
              label="Undo"
              isDisabled={!editable}
              onClick={() => contractEditor?.chain().focus().undo().run()}
              endContent={<Shortcut>⌘Z</Shortcut>}
            />
            <DropdownMenuItem
              label="Redo"
              isDisabled={!editable}
              onClick={() => contractEditor?.chain().focus().redo().run()}
              endContent={<Shortcut>⇧⌘Z</Shortcut>}
            />
            <DropdownMenuSubMenu label="Format text">
              <DropdownMenuItem label="Bold" isDisabled={!editable} onClick={() => contractEditor?.chain().focus().toggleBold().run()} />
              <DropdownMenuItem label="Italic" isDisabled={!editable} onClick={() => contractEditor?.chain().focus().toggleItalic().run()} />
              <DropdownMenuItem label="Heading" isDisabled={!editable} onClick={() => contractEditor?.chain().focus().toggleHeading({ level: 2 }).run()} />
              <DropdownMenuItem label="Bulleted list" isDisabled={!editable} onClick={() => contractEditor?.chain().focus().toggleBulletList().run()} />
              <DropdownMenuItem label="Numbered list" isDisabled={!editable} onClick={() => contractEditor?.chain().focus().toggleOrderedList().run()} />
            </DropdownMenuSubMenu>
          </DropdownMenuSubMenu>
          <DropdownMenuSubMenu label="View">
            <DropdownMenuCheckboxItem
              label="Left panel"
              icon={PanelLeft}
              endContent={<Shortcut>⌘B</Shortcut>}
              value={!!left}
              onChange={(next) => chooseLeft(next ? 'Sections' : null)}
            />
            <DropdownMenuCheckboxItem
              label="Right panel"
              icon={PanelRight}
              endContent={<Shortcut>⇧⌘B</Shortcut>}
              value={!!right}
              onChange={(next) => chooseRight(next ? 'Comments' : null)}
            />
            <DropdownMenuCheckboxItem
              label="Canvas tools"
              icon={PanelTop}
              endContent={<Shortcut>⌘.</Shortcut>}
              value={chrome.toolbar}
              onChange={(next) => setChrome((c) => ({ ...c, toolbar: next }))}
            />
            <DropdownMenuDivider />
            <DropdownMenuSubMenu label="Zoom">
              <DropdownMenuRadioGroup label="Zoom" value={zoom} onChange={setZoom}>
                {ZOOM_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem key={option.value} value={option.value} label={option.label} />
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubMenu>
            <DropdownMenuSubMenu label="Appearance">
              <DropdownMenuRadioGroup
                label="Appearance"
                value={appearance}
                onChange={(next) => {
                  if (next === 'light' || next === 'dark' || next === 'system') {
                    setAppearance(next)
                  }
                }}
              >
                <DropdownMenuRadioItem value="light" label="Light" />
                <DropdownMenuRadioItem value="dark" label="Dark" />
                <DropdownMenuRadioItem value="system" label="System" />
              </DropdownMenuRadioGroup>
            </DropdownMenuSubMenu>
          </DropdownMenuSubMenu>
        </DropdownMenu>

        <CanvasDocumentTab
          title={title}
          compact={compactHeader}
          onSelect={() => {
            if (frozen) {
              artboard.current?.focus()
            } else {
              contractEditor?.commands.focus()
            }
          }}
        />
      </HStack>
    ),
    tools: chrome.toolbar && (
      <HStack role="group" aria-label="Editor tools" height="var(--spacing-8)" width="max-content" maxWidth="100%" xstyle={styles.headerTools} vAlign="center">
        <Toolbar
          label="Canvas tools"
          size="sm"
          startContent={
            <>
              <IconButton
                label="Undo"
                tooltip="Undo"
                variant="ghost"
                icon={<Icon icon={Undo2} size={ICON} />}
                isDisabled={markup ? !markup.undo : !editable}
                {...definedProps({ onClick: markup ? markup.undo : () => contractEditor?.chain().focus().undo().run() })}
              />
              <IconButton
                label="Redo"
                tooltip="Redo"
                variant="ghost"
                icon={<Icon icon={Redo2} size={ICON} />}
                isDisabled={markup ? !markup.redo : !editable}
                {...definedProps({ onClick: markup ? markup.redo : () => contractEditor?.chain().focus().redo().run() })}
              />
              <Divider orientation="vertical" xstyle={styles.toolBarRule} />
              {markup && (
                <>
                  {(
                    [
                      ['select', 'Select', MousePointer2],
                      ['pen', 'Pen', PenTool],
                      ['brush', 'Brush', Brush],
                      ['highlight', 'Highlighter', Highlighter],
                      ['underline', 'Underline', Underline],
                      ['strikethrough', 'Strikethrough', Strikethrough],
                    ] as const
                  ).map(([tool, label, icon]) => (
                    <IconButton
                      key={tool}
                      label={label}
                      tooltip={label}
                      icon={<Icon icon={icon} size={ICON} />}
                      aria-pressed={markup.tool === tool}
                      variant={markup.tool === tool ? 'secondary' : 'ghost'}
                      isDisabled={tool !== 'select' && !markup.writable}
                      onClick={() => markup.setTool(tool)}
                    />
                  ))}
                </>
              )}
              {!frozen && (
                <>
                  <IconButton
                    label="Add text"
                    tooltip="Add text"
                    variant="ghost"
                    icon={<Icon icon={Type} size={ICON} />}
                    isDisabled={!editable}
                    onClick={() => contractEditor?.chain().focus().run()}
                  />
                  <IconButton
                    label="Bold"
                    tooltip="Bold"
                    aria-pressed={Boolean(marks?.bold)}
                    variant={marks?.bold ? 'secondary' : 'ghost'}
                    icon={<Icon icon={Bold} size={ICON} />}
                    isDisabled={!editable}
                    onClick={() => contractEditor?.chain().focus().toggleBold().run()}
                  />
                  <IconButton
                    label="Italic"
                    tooltip="Italic"
                    aria-pressed={Boolean(marks?.italic)}
                    variant={marks?.italic ? 'secondary' : 'ghost'}
                    icon={<Icon icon={Italic} size={ICON} />}
                    isDisabled={!editable}
                    onClick={() => contractEditor?.chain().focus().toggleItalic().run()}
                  />
                  <IconButton
                    label="Underline"
                    tooltip="Underline"
                    aria-pressed={Boolean(marks?.underline)}
                    variant={marks?.underline ? 'secondary' : 'ghost'}
                    icon={<Icon icon={Underline} size={ICON} />}
                    isDisabled={!editable}
                    onClick={() => contractEditor?.chain().focus().toggleUnderline().run()}
                  />
                  <IconButton
                    label="Strikethrough"
                    tooltip="Strikethrough"
                    aria-pressed={Boolean(marks?.strike)}
                    variant={marks?.strike ? 'secondary' : 'ghost'}
                    icon={<Icon icon={Strikethrough} size={ICON} />}
                    isDisabled={!editable}
                    onClick={() => contractEditor?.chain().focus().toggleStrike().run()}
                  />
                </>
              )}
              {onAnnotations && (
                <IconButton
                  label="Annotations"
                  tooltip="Annotations"
                  variant="ghost"
                  icon={<Icon icon={MessageSquare} size={ICON} />}
                  onClick={onAnnotations}
                />
              )}
              {onReplaceText && (
                <IconButton
                  label="Propose text replacement"
                  tooltip="Propose text replacement"
                  variant="ghost"
                  icon={<Icon icon={Replace} size={ICON} />}
                  onClick={onReplaceText}
                />
              )}
              <IconButton
                label="Signature"
                tooltip={signatureAction.label}
                variant="ghost"
                icon={<Icon icon={Signature} size={ICON} />}
                isDisabled={!signatureAction.open}
                {...definedProps({ onClick: signatureAction.open })}
              />
              <Divider orientation="vertical" xstyle={styles.toolBarRule} />
              <Selector label="Zoom" isLabelHidden variant="ghost" value={zoom} onChange={setZoom} options={ZOOM_OPTIONS} placement="below" />
            </>
          }
        />
      </HStack>
    ),
    end: (
      <HStack gap={3} vAlign="center">
        {syncStatus &&
          (compactHeader ? (
            <VisuallyHidden as="span" role="status">
              {syncStatus}
            </VisuallyHidden>
          ) : (
            <Text type="supporting" color="secondary" role="status">
              {syncStatus}
            </Text>
          ))}
        {!chrome.toolbar && onAnnotations && (
          <IconButton
            label="Annotations"
            tooltip="Annotations"
            variant="ghost"
            size="sm"
            icon={<Icon icon={MessageSquare} size="sm" />}
            onClick={onAnnotations}
          />
        )}
        <DropdownMenu
          button={{
            label: 'Export',
            variant: 'ghost',
            size: 'sm',
            isIconOnly: compactHeader,
            ...(compactHeader ? { tooltip: 'Export' } : {}),
            icon: <Icon icon={Download} size={ICON} />,
          }}
          alignment="end"
        >
          {frozen ? (
            frozen.exportActions
          ) : (
            <>
              <DropdownMenuItem label="Share" isDisabled={!onShare} {...definedProps({ onClick: onShare })} />
              <DropdownMenuItem label={signatureAction.label} isDisabled={!signatureAction.open} {...definedProps({ onClick: signatureAction.open })} />
            </>
          )}
        </DropdownMenu>
      </HStack>
    ),
  }

  const railButton = (label: Left | Right, icon: typeof ListTree, active: boolean, click: () => void) => (
    <VStack key={label} gap={0} hAlign="center">
      <IconButton
        label={label}
        tooltip={label}
        icon={<Icon icon={icon} size="sm" />}
        aria-pressed={active}
        variant={active ? 'secondary' : 'ghost'}
        onClick={click}
      />
      {label === 'Suggestions' && !!openCount && (
        <Text type="supporting" aria-label={openCount + ' open suggestions'}>
          {openCount}
        </Text>
      )}
    </VStack>
  )
  const panelTitle = (label: string, close: () => void) => (
    <HStack vAlign="center" gap={2} padding={3}>
      <StackItem size="fill">
        <Heading level={3}>{label}</Heading>
      </StackItem>
      <IconButton label={'Close ' + label} icon={<Icon icon={X} size="sm" />} variant="ghost" onClick={close} />
    </HStack>
  )
  return (
    <Theme theme={neutralTheme} mode={appearance}>
      {renderShell(
        <PdfNavigation.Provider value={{ load: loadPdf, select: onSelectPdf, digest }}>
          <Layout
            height="fill"
            padding={0}
            start={
              <>
                <LayoutPanel width={44} label="Document navigation" padding={1} hasDivider>
                  <VStack gap={1}>
                    {toolsLeft.map(([label, icon]) => railButton(label, icon, left === label, () => chooseLeft(left === label ? null : label)))}
                  </VStack>
                </LayoutPanel>
                {left && !narrow && (
                  <>
                    <LayoutPanel resizable={rail.props} label={left + ' panel'} padding={0} hasDivider>
                      <Layout
                        height="fill"
                        padding={0}
                        header={panelTitle(left, () => chooseLeft(null))}
                        content={
                          <LayoutContent padding={3} isScrollable>
                            {navigation}
                          </LayoutContent>
                        }
                      />
                    </LayoutPanel>
                    <ResizeHandle label="Resize navigation panel" resizable={rail.props} />
                  </>
                )}
              </>
            }
            content={
              <LayoutContent padding={0}>
                <Section variant="muted" padding={0} height="100%">
                  <Layout
                    height="fill"
                    padding={0}
                    content={
                      <LayoutContent padding={narrow ? 2 : 6} isScrollable>
                        {anchor && !frozen && writable && (
                          <HStack gap={1} paddingBlock={2}>
                            <Button label="Comment on selection" size="sm" onClick={() => chooseRight('Comments')} />
                            <Button label="Suggest replacement" size="sm" onClick={() => chooseRight('Suggestions')} />
                          </HStack>
                        )}
                        {frozen && compactHeader && (
                          <VStack gap={1} paddingBlock={2}>
                            <Text weight="semibold">{title}</Text>
                            <Text type="supporting" color="secondary">
                              {syncStatus}
                            </Text>
                          </VStack>
                        )}
                        <HStack width="100%" height="max-content" minHeight="100%" xstyle={styles.canvasStage}>
                          <Theme theme={neutralTheme} mode="light">
                            <VStack
                              as="article"
                              aria-label="Contract artboard"
                              ref={artboard}
                              tabIndex={frozen ? -1 : undefined}
                              width="100%"
                              maxWidth={840}
                              xstyle={styles.artboardCentered(scale)}
                            >
                              {frozen ? (
                                frozen.pdf
                              ) : (
                                <Card padding={0} elevation="med" minHeight={960}>
                                  <EditorContent className="canvas-contract-text" editor={contractEditor} />
                                </Card>
                              )}
                            </VStack>
                          </Theme>
                        </HStack>
                      </LayoutContent>
                    }
                  />
                </Section>
              </LayoutContent>
            }
            end={
              <>
                {right && !narrow && (
                  <>
                    <ResizeHandle label="Resize collaboration panel" resizable={inspector.props} isReversed />
                    <LayoutPanel label={right + ' panel'} resizable={inspector.props} hasDivider padding={0}>
                      <Layout
                        height="fill"
                        padding={0}
                        header={panelTitle(right, () => chooseRight(null))}
                        content={
                          <LayoutContent padding={3} isScrollable>
                            {review}
                          </LayoutContent>
                        }
                      />
                    </LayoutPanel>
                  </>
                )}
                <LayoutPanel width={44} label="Collaboration tools" padding={1} hasDivider>
                  <VStack gap={1}>
                    {toolsRight
                      .filter(([label]) => canReview || label === 'People')
                      .map(([label, icon]) => railButton(label, icon, right === label, () => chooseRight(right === label ? null : label)))}
                  </VStack>
                </LayoutPanel>
              </>
            }
          />
          {narrow && (right || left) && (
            <Drawer
              isOpen
              onOpenChange={(open) => {
                if (!open) {
                  setLeft(null)
                  setRight(null)
                }
              }}
              side={right ? 'end' : 'start'}
              label={right ?? left ?? ''}
              width={340}
            >
              <VStack gap={3}>
                <DrawerHeader
                  title={right ?? left ?? ''}
                  onOpenChange={() => {
                    setLeft(null)
                    setRight(null)
                  }}
                />
                {right ? review : navigation}
              </VStack>
            </Drawer>
          )}
        </PdfNavigation.Provider>,
        header,
      )}
    </Theme>
  )
}
