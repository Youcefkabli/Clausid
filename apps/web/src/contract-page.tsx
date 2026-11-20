import * as stylex from '@stylexjs/stylex'
import { List, ListItem } from '@astryxdesign/core/List'
import { definedProps } from './defined-props.ts'
import { contractViewSchema, previewSchema, workspaceAccessSchema } from '@clausid/contracts'
import type { MarkupTool, MarkupControls } from './app/canvas-editor/pdf-markup.tsx'
import { AccountSettingsDialog } from './account-settings.tsx'
import CanvasEditor from './app/canvas-editor/page.tsx'
import type { CanvasHeader } from './app/canvas-editor/page.tsx'
import { Layout, LayoutContent, LayoutFooter, LayoutHeader } from '@astryxdesign/core/Layout'
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack'
import { Step, Stepper } from '@astryxdesign/core/Stepper'
import { Banner } from '@astryxdesign/core/Banner'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { Heading } from '@astryxdesign/core/Heading'
import { Link } from '@astryxdesign/core/Link'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react'
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden'
import type { FormEvent, ReactNode } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { DropdownMenuItem } from '@astryxdesign/core/DropdownMenu'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import type { ContractView, Preview } from '@clausid/contracts'
import { consentText, consentVersion, previewContract } from '@clausid/contracts'
import { api, errorMessage } from './api.ts'
import { useWorkspacePresence } from './participants.tsx'
import { connectContract } from './connection.ts'
import type { ConnectionState } from './connection.ts'
import { clearProjection, project, useProjection } from './store.ts'
import type { AppStore } from './store.ts'

const styles = stylex.create({
  editor: { overflow: 'hidden' },
  viewport: { minHeight: 0, minWidth: 0 },
})

const FrozenPdf = lazy(() => import('./app/canvas-editor/frozen-pdf.tsx'))

export function ContractPage({
  id,
  account,
  store,
  renderPage,
}: {
  id: string
  account: { id: string; name: string; email: string }
  store: AppStore
  renderPage: (content: ReactNode, editorHeader?: CanvasHeader) => ReactNode
}) {
  const [room] = useState(() => {
    const document = new Y.Doc()
    return { document, awareness: new Awareness(document) }
  })
  const row = useProjection(store, id, contractViewSchema)
  const contract = row.kind === 'ready' ? row.data : null
  const [connection, setConnection] = useState<ConnectionState>({ ready: false, pending: 0, error: '', ended: false, retryable: false })
  const retryConnection = useRef<() => void>(() => undefined)
  const [started, setStarted] = useState(false)
  const [error, setError] = useState('')
  const [accountOpen, setAccountOpen] = useState(false)
  const [share, setShare] = useState(false)
  const [sharingAccess, setSharingAccess] = useState<{ workspaceId?: string | undefined; canManage: boolean; canViewParticipants?: boolean | undefined }>()
  const presence = useWorkspacePresence(sharingAccess?.canViewParticipants ? sharingAccess.workspaceId : undefined, id, room.document)
  const [prepare, setPrepare] = useState(false)
  const [signaturesOpen, setSignaturesOpen] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const [preview, setPreview] = useState<(Preview & { signers: string[] }) | null>(null)
  const [markupTool, setMarkupTool] = useState<MarkupTool>('select')
  const [redoMarks, setRedoMarks] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [signerEmails, setSignerEmails] = useState('')
  const signerForm = useId()
  const [signingName, setSigningName] = useState('')
  const [consent, setConsent] = useState(false)
  const [copyId] = useState(() => crypto.randomUUID())
  const latestView = useRef<ContractView | null>(null)
  const publishView = useCallback(
    (view: ContractView) => {
      const latest = latestView.current
      if (
        latest &&
        (view.revision < latest.revision ||
          (view.status === 'Draft' && latest.status !== 'Draft') ||
          ((latest.status === 'Signed' || latest.status === 'Voided') && view.status !== latest.status))
      ) {
        return
      }
      latestView.current = view
      project(store, id, view)
    },
    [store, id],
  )
  useEffect(() => {
    let active = true
    const abort = new AbortController()
    const receive = publishView
    void api(contractViewSchema, '/' + id, undefined, abort.signal)
      .then((view) => {
        if (active && !latestView.current) {
          receive(view)
        }
      })
      .catch((reason) => {
        if (active && !latestView.current) {
          setError(errorMessage(reason))
        }
      })
    const close = connectContract(
      id,
      room.document,
      room.awareness,
      (message) => {
        if (message.type === 'state') {
          receive(message.contract)
          if (message.draft !== undefined) {
            setStarted(true)
          }
        }
        const current = latestView.current
        if ((message.type === 'ack' || message.type === 'edit') && current) {
          receive({ ...current, revision: Math.max(current.revision, message.revision) })
        }
      },
      setConnection,
    )
    retryConnection.current = () => close.retry()
    return () => {
      active = false
      abort.abort()
      close.dispose()
      room.awareness.destroy()
      room.document.destroy()
      clearProjection(store, id)
    }
  }, [id, room, store, publishView])

  useEffect(() => {
    if (!contract) {
      return
    }
    const abort = new AbortController()
    void api(workspaceAccessSchema, '/' + id + '/workspace', undefined, abort.signal)
      .then((entry) => {
        if (!abort.signal.aborted) {
          setSharingAccess(entry)
        }
      })
      .catch((reason) => {
        if (!abort.signal.aborted) {
          setError(errorMessage(reason))
        }
      })
    return () => abort.abort()
  }, [id, contract?.role])

  const path = '/' + id + '/'
  const file = '/api/contracts' + path
  async function mutate(action: string, body: object = {}) {
    setError('')
    setBusy(true)
    try {
      const view = await api(contractViewSchema, path + action, body)
      publishView(view)
      return view
    } catch (error) {
      setError(errorMessage(error))
      return null
    } finally {
      setBusy(false)
    }
  }
  async function preparePdf(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!contract) {
      return
    }
    const signers = new FormData(event.currentTarget).get('signers')
    const input = typeof signers === 'string' ? signers : ''
    const result = previewContract.safeParse({
      revision: contract.revision,
      signers: input.split(/[\s,;]+/).filter(Boolean),
    })
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? 'Enter valid signer emails.')
      return
    }
    setError('')
    setBusy(true)
    try {
      const pdf = await api(previewSchema, path + 'preview', result.data)
      setPreview({ ...pdf, signers: result.data.signers })
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  function changePrepareOpen(open: boolean) {
    setPrepare(open)
    if (!open) {
      setPreview(null)
      setSignerEmails('')
      setError('')
    }
  }

  const projectionError = row.kind === 'invalid' ? row.message : ''
  const alerts = <>{(error || projectionError) && <Banner status="error" title={error || projectionError} role="alert" />}</>
  if (!contract) {
    return renderPage(!(error || projectionError) ? <Text role="status">Opening contract…</Text> : alerts)
  }
  const version = contract.version
  const draft = contract.status === 'Draft'
  const owner = contract.role === 'owner'
  const canManage = owner && sharingAccess?.canManage
  const canPrepare =
    canManage &&
    !contract.threads?.some((item) => item.replacement !== undefined && !item.decision) &&
    !contract.annotations?.some((annotation) => !annotation.withdrawn && !annotation.decision) &&
    connection.ready &&
    !connection.error &&
    connection.pending === 0
  const canEdit = draft && contract.role !== 'signer' && !contract.sourcePdf && !connection.error && !connection.ended
  const recoverable = started && connection.pending > 0 && Boolean(connection.error)
  const openModal = (set: (open: boolean) => void) => {
    setError('')
    setNotice('')
    set(true)
  }
  const changeShareOpen = (open: boolean) => {
    setShare(open)
    if (!open) {
      setError('')
    }
  }
  const changeSignaturesOpen = (open: boolean) => {
    setSignaturesOpen(open)
    if (!open) {
      setError('')
    }
  }
  const changeVoidOpen = (open: boolean) => {
    setVoidOpen(open)
    if (!open) {
      setError('')
    }
  }
  const pageFeedback = (
    <>
      {!share && !prepare && !voidOpen && !signaturesOpen && alerts}
      {connection.error && (
        <Banner
          status="error"
          title={connection.error}
          description={recoverable ? 'Copy your local changes before leaving this page.' : undefined}
          role="alert"
        />
      )}
      {connection.retryable && <Button label="Retry connection" onClick={() => retryConnection.current()} />}
    </>
  )
  const dialogs = (
    <>
      <Dialog isOpen={share && draft && !connection.ended} onOpenChange={changeShareOpen} aria-label="Share contract" purpose="form">
        <Layout
          padding={4}
          defaultHasDividers
          header={<DialogHeader title="Share contract" onOpenChange={changeShareOpen} />}
          content={
            <LayoutContent>
              <VStack gap={4}>
                {sharingAccess?.workspaceId && (
                  <VStack gap={3}>
                    <Text>Give the current workspace parties access to edit this draft.</Text>
                    <HStack>
                      <Button
                        label="Share with workspace"
                        isDisabled={busy}
                        clickAction={async () => {
                          if (await mutate('share-workspace')) {
                            setNotice('Workspace parties can now edit this draft.')
                          }
                        }}
                      />
                    </HStack>
                  </VStack>
                )}
                <form
                  onSubmit={async (event) => {
                    event.preventDefault()
                    const form = event.currentTarget
                    if (await mutate('invite', { email: new FormData(form).get('email') })) {
                      setInviteEmail('')
                      setNotice('Invitation queued for delivery.')
                    }
                  }}
                >
                  <VStack gap={3}>
                    <TextInput
                      label="Collaborator email"
                      type="email"
                      htmlName="email"
                      isRequired
                      {...{ required: true }}
                      value={inviteEmail}
                      onChange={setInviteEmail}
                      width="100%"
                    />
                    <HStack>
                      <Button type="submit" label="Send invitation" variant="primary" isLoading={busy} />
                    </HStack>
                  </VStack>
                </form>
                {alerts}
                {notice && <Text role="status">{notice}</Text>}
                {!!(contract.editors.length > 1 || contract.invites.length) && (
                  <List edge="flush" aria-label="Contract collaborators">
                    {contract.editors.slice(1).map((person) => (
                      <ListItem
                        key={person.id}
                        label={person.email}
                        description="Editor"
                        endContent={
                          <Button
                            label="Revoke access"
                            size="sm"
                            isDisabled={busy}
                            clickAction={async () => {
                              await mutate('revoke/' + person.id)
                            }}
                          />
                        }
                      />
                    ))}
                    {contract.invites.map((invite) => (
                      <ListItem
                        key={invite.id}
                        label={invite.email}
                        description="Invitation pending"
                        endContent={
                          <Button
                            label="Cancel invite"
                            size="sm"
                            isDisabled={busy}
                            clickAction={async () => {
                              await mutate('revoke/' + invite.id)
                            }}
                          />
                        }
                      />
                    ))}
                  </List>
                )}
              </VStack>
            </LayoutContent>
          }
          footer={
            <LayoutFooter>
              <HStack hAlign="end">
                <Button label="Done" onClick={() => changeShareOpen(false)} />
              </HStack>
            </LayoutFooter>
          }
        />
      </Dialog>
      {/* Astryx CLI 0.7.16, form-wizard-dialog template. */}
      <Dialog isOpen={prepare && draft && !connection.ended} onOpenChange={changePrepareOpen} width={620} purpose="form">
        <Layout
          height="fill"
          padding={4}
          defaultHasDividers
          header={
            <>
              <DialogHeader title="Prepare for signing" onOpenChange={changePrepareOpen} hasDivider={false} />
              <LayoutHeader hasDivider={false}>
                <Stepper activeStep={preview ? 1 : 0} orientation="horizontal" density="compact" label="Signing setup progress">
                  <Step step={0} label="Add signers" />
                  <Step step={1} label="Review PDF" />
                </Stepper>
              </LayoutHeader>
            </>
          }
          content={
            <LayoutContent isScrollable={Boolean(contract.sourcePdf && preview)}>
              <VStack gap={4}>
                {preview ? (
                  <>
                    <Text>Review this PDF and confirm the required signers.</Text>
                    {contract.sourcePdf && (
                      <Text>The PDF below is the exact version prepared for signature. Annotations and decisions remain in the negotiation history.</Text>
                    )}
                    <List edge="flush" aria-label="Required signers">
                      {preview.signers.map((email) => (
                        <ListItem key={email} label={email} />
                      ))}
                    </List>
                    <Link href={file + 'preview/' + preview.id} target="_blank" rel="noreferrer">
                      Open preview in a new tab
                    </Link>
                    {contract.sourcePdf ? (
                      <Suspense fallback={<Text role="status">Loading PDF…</Text>}>
                        <FrozenPdf key={preview.id} url={file + 'preview/' + preview.id} label="Signing preview PDF" pageAnchors={false} />
                      </Suspense>
                    ) : (
                      <iframe className="preview-frame" src={file + 'preview/' + preview.id} title="Contract signing preview" />
                    )}
                  </>
                ) : (
                  <form onSubmit={preparePdf} id={signerForm}>
                    <TextArea
                      label="Signer email addresses"
                      htmlName="signers"
                      placeholder="One email address per line"
                      rows={4}
                      width="100%"
                      isRequired
                      {...{ required: true }}
                      value={signerEmails}
                      onChange={setSignerEmails}
                    />
                  </form>
                )}
                {alerts}
              </VStack>
            </LayoutContent>
          }
          footer={
            <LayoutFooter>
              <HStack gap={2} vAlign="center">
                <Button
                  label="Back"
                  isDisabled={!preview || busy}
                  onClick={() => {
                    setPreview(null)
                    setError('')
                  }}
                />
                <StackItem size="fill" />
                {preview ? (
                  <Button
                    label="Freeze and send"
                    variant="primary"
                    isDisabled={busy || !canPrepare}
                    clickAction={async () => {
                      if (await mutate('freeze', { previewId: preview.id })) {
                        changePrepareOpen(false)
                      }
                    }}
                  />
                ) : (
                  <Button label="Generate PDF preview" type="submit" form={signerForm} variant="primary" isDisabled={busy || !canPrepare} />
                )}
              </HStack>
            </LayoutFooter>
          }
        />
      </Dialog>
      <Dialog isOpen={signaturesOpen && !draft && !connection.ended} aria-label="Signatures" onOpenChange={changeSignaturesOpen} purpose="form">
        <Layout
          padding={4}
          defaultHasDividers
          header={<DialogHeader title="Signatures" onOpenChange={changeSignaturesOpen} />}
          content={
            <LayoutContent>
              <VStack gap={4}>
                {version && (
                  <List edge="flush" aria-label="Required signers">
                    {version.signers.map((signer) => (
                      <ListItem
                        key={signer.email}
                        label={signer.email}
                        description={signer.signedAt ? 'Signed ' + new Date(signer.signedAt).toLocaleString() : 'Pending'}
                      />
                    ))}
                  </List>
                )}
                {version?.canSign && (
                  <form
                    onSubmit={async (event) => {
                      event.preventDefault()
                      const fields = new FormData(event.currentTarget)
                      if (
                        await mutate('sign', {
                          versionId: version.id,
                          digest: version.digest,
                          name: fields.get('name'),
                          consent: fields.has('consent'),
                          consentVersion,
                        })
                      ) {
                        changeSignaturesOpen(false)
                      }
                    }}
                  >
                    <VStack gap={3}>
                      <TextInput
                        label="Full name"
                        htmlName="name"
                        autoComplete="name"
                        isRequired
                        {...{ required: true, maxLength: 120 }}
                        value={signingName}
                        onChange={setSigningName}
                      />
                      <CheckboxInput label={consentText} htmlName="consent" value={consent} onChange={setConsent} isRequired />
                      <Button label="Sign contract" type="submit" variant="primary" isLoading={busy} />
                    </VStack>
                  </form>
                )}
                {alerts}
              </VStack>
            </LayoutContent>
          }
          footer={
            <LayoutFooter>
              <HStack hAlign="end">
                <Button label="Done" onClick={() => changeSignaturesOpen(false)} />
              </HStack>
            </LayoutFooter>
          }
        />
      </Dialog>
      <Dialog isOpen={voidOpen} onOpenChange={changeVoidOpen} aria-label="Void contract" purpose="form">
        <Layout
          padding={4}
          defaultHasDividers
          header={<DialogHeader title="Void contract" onOpenChange={changeVoidOpen} />}
          content={
            <LayoutContent>
              <VStack gap={3}>
                <Text>Pending signers will lose the ability to sign this version.</Text>
                {alerts}
              </VStack>
            </LayoutContent>
          }
          footer={
            <LayoutFooter>
              <HStack gap={2} hAlign="end">
                <Button label="Cancel" onClick={() => changeVoidOpen(false)} />
                <Button
                  label="Confirm void"
                  variant="destructive"
                  isDisabled={busy}
                  clickAction={async () => {
                    if (await mutate('void')) {
                      changeVoidOpen(false)
                    }
                  }}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </Dialog>
    </>
  )

  const renderCanvas = (canvas: ReactNode, header: CanvasHeader) =>
    renderPage(
      <VStack gap={0} width="100%" height="100%" xstyle={styles.editor} data-testid="contract-editor">
        {(contract.sourcePdf || contract.version) && <VisuallyHidden as="h1">{contract.title}</VisuallyHidden>}
        {pageFeedback}
        <StackItem size="fill" xstyle={styles.viewport}>
          {canvas}
        </StackItem>
        {dialogs}
        {accountOpen && <AccountSettingsDialog isOpen={accountOpen} onOpenChange={setAccountOpen} account={account} />}
      </VStack>,
      header,
    )

  if (draft && ((!contract.sourcePdf && !started) || (connection.ended && !recoverable))) {
    return renderPage(
      <VStack gap={3}>
        <Link href="/">Back to contracts</Link>
        <Heading level={1}>{contract.title}</Heading>
        {pageFeedback}
        {!connection.ended && (
          <Text color="secondary" role="status">
            Connecting…
          </Text>
        )}
      </VStack>,
    )
  }

  const negotiated = contract.negotiatedPdf
  const draftPdfPath = negotiated ? 'negotiated-pdf/' + negotiated.digest : 'source-pdf'
  const annotations = contract.annotations ?? []
  const writableMarks = Boolean(draft && contract.sourcePdf && contract.role !== 'signer' && connection.ready && !connection.error && !busy)
  const undoMark = annotations.filter((item) => item.markup && !item.withdrawn && !item.decision && item.author === account.email).at(-1)
  const redoMark = annotations.find((item) => item.id === redoMarks.at(-1) && item.withdrawn && !item.decision)
  const markup: MarkupControls | undefined = contract.sourcePdf
    ? {
        tool: markupTool,
        setTool: setMarkupTool,
        annotations,
        writable: writableMarks,
        busy,
        add: async (page, mark, context) => {
          const result = await mutate('annotation', { action: 'add', page, text: '', markup: mark, ...context })
          if (result) {
            setRedoMarks([])
          }
          return result
        },
        undo:
          writableMarks && undoMark
            ? async () => {
                if (await mutate('annotation', { action: 'visibility', id: undoMark.id, withdrawn: true })) {
                  setRedoMarks((current) => [...current, undoMark.id])
                }
              }
            : undefined,
        redo:
          writableMarks && redoMark
            ? async () => {
                if (await mutate('annotation', { action: 'visibility', id: redoMark.id, withdrawn: false })) {
                  setRedoMarks((current) => current.slice(0, -1))
                }
              }
            : undefined,
      }
    : undefined
  const pdf = (version || contract.sourcePdf) && !connection.ended && (
    <Suspense fallback={<Text role="status">Loading PDF…</Text>}>
      <FrozenPdf
        key={version?.id ?? negotiated?.digest ?? id}
        url={file + (version ? 'pdf' : draftPdfPath)}
        {...definedProps({ markup: markup })}
        {...definedProps({ label: version ? undefined : negotiated ? 'Clean negotiated PDF' : 'Contract PDF' })}
      />
    </Suspense>
  )
  const signatureAction = draft
    ? { label: 'Prepare for signing', open: canPrepare && !connection.ended ? () => openModal(setPrepare) : undefined }
    : { label: version?.canSign ? 'Sign contract' : 'View signatures', open: version && !connection.ended ? () => openModal(setSignaturesOpen) : undefined }
  const exportActions = !connection.ended && (
    <>
      {draft && contract.sourcePdf && (
        <>
          <DropdownMenuItem label="Open PDF in a new tab" href={file + draftPdfPath} target="_blank" />
          {negotiated && <DropdownMenuItem label="Open original PDF" href={file + 'source-pdf'} target="_blank" />}
          <DropdownMenuItem label="Share" isDisabled={!canManage} onClick={() => openModal(setShare)} />
          <DropdownMenuItem label={signatureAction.label} isDisabled={!signatureAction.open} {...definedProps({ onClick: signatureAction.open })} />
        </>
      )}
      {version && (
        <>
          <DropdownMenuItem label="Open PDF in a new tab" href={file + 'pdf'} target="_blank" />
          <DropdownMenuItem label={signatureAction.label} {...definedProps({ onClick: signatureAction.open })} />
        </>
      )}
      {contract.status === 'Signed' && <DropdownMenuItem label="Download signing evidence" href={file + 'evidence'} />}
      {owner && contract.status === 'Awaiting signatures' && (
        <DropdownMenuItem label="Void contract" variant="destructive" onClick={() => openModal(setVoidOpen)} />
      )}
      {canManage && contract.status === 'Voided' && (
        <DropdownMenuItem
          label="Duplicate as draft"
          isDisabled={busy}
          onClick={async () => {
            const copy = await mutate('duplicate', { title: contract.title, requestId: copyId })
            if (copy) {
              location.assign('/contracts/' + copy.id)
            }
          }}
        />
      )}
    </>
  )

  return (
    <CanvasEditor
      title={contract.title}
      document={room.document}
      awareness={room.awareness}
      name={account.name}
      accountId={account.id}
      presence={presence}
      workspaceParticipants={Boolean(sharingAccess?.canViewParticipants)}
      connected={connection.ready}
      editable={canEdit}
      {...definedProps({ frozen: contract.sourcePdf || (!draft && !recoverable) ? { pdf, exportActions } : undefined })}
      syncStatus={
        draft && !connection.ended
          ? connection.retryable
            ? 'Connection needs retry'
            : !connection.ready
              ? 'Reconnecting…'
              : connection.pending
                ? 'Saving changes…'
                : 'Saved'
          : contract.status
      }
      contract={contract}
      email={account.email}
      busy={busy}
      error={error}
      mutate={mutate}
      {...definedProps({ onShare: draft && canManage && !connection.ended ? () => openModal(setShare) : undefined })}
      signatureAction={signatureAction}
      {...definedProps({ markup: markup })}
      onAccountSettings={() => setAccountOpen(true)}
      renderShell={renderCanvas}
    />
  )
}
