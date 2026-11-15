import { Layout, LayoutContent, LayoutFooter, LayoutHeader } from '@astryxdesign/core/Layout'
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack'
import { Step, Stepper } from '@astryxdesign/core/Stepper'
import { statusVariant } from './status.ts'
import { Badge } from '@astryxdesign/core/Badge'
import { Banner } from '@astryxdesign/core/Banner'
import { Card } from '@astryxdesign/core/Card'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { Heading } from '@astryxdesign/core/Heading'
import { Link } from '@astryxdesign/core/Link'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { useEffect, useId, useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import type { ContractView, Preview } from '@clausid/contracts'
import { consentText, consentVersion, previewContract } from '@clausid/contracts'
import { api, errorMessage } from './api.ts'
import { connectContract } from './connection.ts'
import type { ConnectionState } from './connection.ts'
import { clearProjection, project, useProjection } from './store.ts'
import type { AppStore } from './store.ts'

function Editor({ document, awareness, name, editable }: {
  document: Y.Doc; awareness: Awareness; name: string; editable: boolean
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false, undoRedo: false, trailingNode: false }),
      Collaboration.configure({ document }),
      CollaborationCaret.configure({ provider: { awareness }, user: { name, color: '#246a59' } }),
    ],
    editorProps: { attributes: { 'aria-label': 'Contract document', role: 'textbox', 'aria-multiline': 'true' } },
    editable,
  }, [document, awareness, name])
  useEffect(() => { editor?.setEditable(editable) }, [editor, editable])
  const current = useEditorState({ editor, selector: ({ editor }) => editor ? {
    bold: editor.isActive('bold'), italic: editor.isActive('italic'), heading: editor.isActive('heading', { level: 2 }),
    bulletList: editor.isActive('bulletList'), orderedList: editor.isActive('orderedList'),
  } : undefined })
  return <Card padding={5}><div className="flow">
    {editable && <div className="actions" role="group" aria-label="Document formatting">
      <Button label="Bold" size="sm" aria-pressed={current?.bold} onClick={() => editor?.chain().focus().toggleBold().run()} />
      <Button label="Italic" size="sm" aria-pressed={current?.italic} onClick={() => editor?.chain().focus().toggleItalic().run()} />
      <Button label="Heading" size="sm" aria-pressed={current?.heading} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} />
      <Button label="Bulleted list" size="sm" aria-pressed={current?.bulletList} onClick={() => editor?.chain().focus().toggleBulletList().run()} />
      <Button label="Numbered list" size="sm" aria-pressed={current?.orderedList} onClick={() => editor?.chain().focus().toggleOrderedList().run()} />
    </div>}
    <EditorContent editor={editor} />
  </div></Card>
}

export function ContractPage({ id, name, store }: { id: string; name: string; store: AppStore }) {
  const [room] = useState(() => {
    const document = new Y.Doc()
    return { document, awareness: new Awareness(document) }
  })
  const row = useProjection(store, id)
  const contract = row ? JSON.parse(row.value) as ContractView : null
  const [connection, setConnection] = useState<ConnectionState>({ ready: false, pending: 0, error: '', ended: false })
  const [started, setStarted] = useState(false)
  const [error, setError] = useState('')
  const [share, setShare] = useState(false)
  const [prepare, setPrepare] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const [preview, setPreview] = useState<(Preview & { signers: string[] }) | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [signerEmails, setSignerEmails] = useState('')
  const signerForm = useId()
  const [signingName, setSigningName] = useState('')
  const [consent, setConsent] = useState(false)
  const [copyId] = useState(() => crypto.randomUUID())
  useEffect(() => {
    let active = true
    const abort = new AbortController()
    let current: ContractView | null = null
    const receive = (view: ContractView) => { current = view; project(store, id, view) }
    void api<ContractView>('/' + id, undefined, abort.signal).then((view) => {
      if (active && !current) receive(view)
    }).catch((reason) => { if (active && !current) setError(errorMessage(reason)) })
    const close = connectContract(id, room.document, room.awareness, (message) => {
      if (message.type === 'state') {
        receive(message.contract)
        if (message.draft !== undefined) setStarted(true)
      }
      if ((message.type === 'ack' || message.type === 'edit') && current) {
        receive({ ...current, revision: Math.max(current.revision, message.revision) })
      }
    }, setConnection)
    return () => {
      active = false; abort.abort(); close()
      room.awareness.destroy(); room.document.destroy(); clearProjection(store, id)
    }
  }, [id, room, store])

  const path = '/' + id + '/'
  const file = '/api/contracts' + path
  async function mutate(action: string, body: object = {}) {
    setError('')
    setBusy(true)
    try {
      const view = await api<ContractView>(path + action, body)
      project(store, id, view)
      return view
    } catch (error) { setError(errorMessage(error)); return null } finally { setBusy(false) }
  }
  async function preparePdf(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!contract) return
    const input = String(new FormData(event.currentTarget).get('signers'))
    const result = previewContract.safeParse({
      revision: contract.revision, signers: input.split(/[\s,;]+/).filter(Boolean),
    })
    if (!result.success) { setError(result.error.issues[0]?.message ?? 'Enter valid signer emails.'); return }
    setError('')
    setBusy(true)
    try {
      const pdf = await api<Preview>(path + 'preview', result.data)
      setPreview({ ...pdf, signers: result.data.signers })
    } catch (error) { setError(errorMessage(error)) } finally { setBusy(false) }
  }
  function changePrepareOpen(open: boolean) {
    setPrepare(open)
    if (!open) {
      setPreview(null)
      setSignerEmails('')
      setError('')
    }
  }

  const alerts = <>{error && <div role="alert"><Banner status="error" title={error} /></div>}</>
  if (!contract) return !error ? <p role="status">Opening contract…</p> : alerts
  const draft = contract.status === 'Draft'
  const owner = contract.role === 'owner'
  const canPrepare = connection.ready && !connection.error && connection.pending === 0
  const canEdit = draft && !connection.error && !connection.ended
  const recoverable = started && connection.pending > 0 && Boolean(connection.error)
  const openModal = (set: (open: boolean) => void) => { setError(''); setNotice(''); set(true) }
  return <div className="flow">
    <div className="contract-top">
      <div className="flow"><Link href="/">Back to contracts</Link><Heading level={1}>{contract.title}</Heading></div>
      <Badge label={contract.status} variant={statusVariant[contract.status]} />
      <div className="actions">
        {draft && owner && !connection.ended && <>
          <Button label="Share" onClick={() => openModal(setShare)} />
          <Button label="Prepare for signing" variant="primary" isDisabled={!canPrepare} onClick={() => openModal(setPrepare)} />
        </>}
        {owner && contract.status === 'Awaiting signatures' && <Button label="Void contract" onClick={() => openModal(setVoidOpen)} />}
        {owner && contract.status === 'Voided' && <Button label="Duplicate as draft" clickAction={async () => {
          const copy = await mutate('duplicate', { title: contract.title, requestId: copyId })
          if (copy) location.assign('/contracts/' + copy.id)
        }} />}
      </div>
    </div>
    {!share && !prepare && !voidOpen && alerts}
    {connection.error && <div role="alert"><Banner status="error" title={connection.error}
      description={recoverable ? 'Copy your local changes before leaving this page.' : undefined} /></div>}
    <div className="workspace-grid">
      <section className="flow" aria-label={draft ? 'Draft' : 'Frozen contract'}>
        {draft && !connection.ended && <Text color="secondary" role="status">
          {!connection.ready ? (started ? 'Reconnecting…' : 'Connecting…') : connection.pending ? 'Saving changes…' : 'Saved'}
        </Text>}
        {started && ((draft && !connection.ended) || recoverable) && (
          <Editor document={room.document} awareness={room.awareness} name={name} editable={canEdit} />
        )}
        {!draft && contract.version && !connection.ended && <Card><div className="flow">
          <Link href={file + 'pdf'} target="_blank" rel="noreferrer">Open PDF in a new tab</Link>
          <iframe src={file + 'pdf'} title="Frozen contract PDF" />
        </div></Card>}
      </section>
      {!connection.ended && <aside><Card padding={5}><div className="flow">
        <Heading level={2}>{draft ? 'Collaborators' : 'Signatures'}</Heading>
        {draft && <ul>{contract.editors.map((editor) => <li key={editor.id}>{editor.email}</li>)}</ul>}
        {contract.version && <ul>{contract.version.signers.map((signer) => <li key={signer.email}>
          {signer.email}<small>{signer.signedAt ? 'Signed ' + new Date(signer.signedAt).toLocaleString() : 'Pending'}</small>
        </li>)}</ul>}
        {contract.version?.canSign && <form onSubmit={async (event) => {
          event.preventDefault()
          const fields = new FormData(event.currentTarget)
          await mutate('sign', { versionId: contract.version!.id, digest: contract.version!.digest,
            name: fields.get('name'), consent: fields.has('consent'), consentVersion })
        }}>
          <TextInput label="Full name" htmlName="name" autoComplete="name" isRequired {...{ required: true, maxLength: 120 }} value={signingName} onChange={setSigningName} />
          <CheckboxInput label={consentText} htmlName="consent" value={consent} onChange={setConsent} isRequired />
          <Button label="Sign contract" type="submit" variant="primary" isDisabled={busy} />
        </form>}
        {contract.status === 'Signed' && <Button label="Download signing evidence" href={file + 'evidence'} variant="primary" />}
      </div></Card></aside>}
    </div>

    <Dialog isOpen={share && draft && !connection.ended} onOpenChange={(open) => { setShare(open); if (!open) setError('') }} aria-label="Share contract">
      <div className="flow"><Heading level={2}>Share contract</Heading>
      <form onSubmit={async (event) => {
        event.preventDefault()
        const form = event.currentTarget
        if (await mutate('invite', { email: new FormData(form).get('email') })) {
          setInviteEmail(''); setNotice('Invitation queued for delivery.')
        }
      }}>
        <TextInput label="Collaborator email" type="email" htmlName="email" isRequired {...{ required: true }} value={inviteEmail} onChange={setInviteEmail} />
        <Button type="submit" label="Send invitation" variant="primary" isDisabled={busy} />
      </form>
      {alerts}
      {notice && <p role="status">{notice}</p>}
      <ul className="people">
        {contract.editors.slice(1).map((person) => <li key={person.id}>{person.email}<Button label="Revoke access"
          clickAction={async () => { await mutate('revoke/' + person.id) }} /></li>)}
        {contract.invites.map((invite) => <li key={invite.id}>{invite.email}<Button label="Cancel invite"
          clickAction={async () => { await mutate('revoke/' + invite.id) }} /></li>)}
      </ul>
      <Button label="Done" onClick={() => setShare(false)} />
    </div></Dialog>
    {/* Astryx CLI 0.7.16, form-wizard-dialog template. */}
    <Dialog isOpen={prepare && draft && !connection.ended} onOpenChange={changePrepareOpen}
      width={620} purpose="form" padding={0}>
      <Layout height="fill" padding={4} defaultHasDividers
        header={<>
          <DialogHeader title="Prepare for signing" onOpenChange={changePrepareOpen} hasDivider={false} />
          <LayoutHeader hasDivider={false}>
            <Stepper activeStep={preview ? 1 : 0} orientation="horizontal" density="compact" label="Signing setup progress">
              <Step step={0} label="Add signers" />
              <Step step={1} label="Review PDF" />
            </Stepper>
          </LayoutHeader>
        </>}
        content={<LayoutContent>
          <VStack gap={4}>
            {preview ? <>
              <Text>Review this PDF and confirm the required signers.</Text>
              <ul>{preview.signers.map((email) => <li key={email}>{email}</li>)}</ul>
              <Link href={file + 'preview/' + preview.id} target="_blank" rel="noreferrer">Open preview in a new tab</Link>
              <iframe className="preview-frame" src={file + 'preview/' + preview.id} title="Contract signing preview" />
            </> : <form onSubmit={preparePdf} id={signerForm} className="template-form">
              <TextArea label="Signer email addresses" htmlName="signers" placeholder="One email address per line"
                rows={4} width="100%" isRequired {...{ required: true }} value={signerEmails} onChange={setSignerEmails} />
            </form>}
            {alerts}
          </VStack>
        </LayoutContent>}
        footer={<LayoutFooter>
          <HStack gap={2} vAlign="center">
            <Button label="Back" isDisabled={!preview || busy} onClick={() => { setPreview(null); setError('') }} />
            <StackItem size="fill" />
            {preview ? <Button label="Freeze and send" variant="primary" isDisabled={busy || !canPrepare} clickAction={async () => {
              if (await mutate('freeze', { previewId: preview.id })) changePrepareOpen(false)
            }} /> : <Button label="Generate PDF preview" type="submit" form={signerForm}
              variant="primary" isDisabled={busy || !canPrepare} />}
          </HStack>
        </LayoutFooter>}
      />
    </Dialog>
    <Dialog isOpen={voidOpen} onOpenChange={setVoidOpen} aria-label="Void contract">
      <div className="flow"><Heading level={2}>Void contract</Heading>
      <p>Pending signers will lose the ability to sign this version.</p>
      {alerts}
      <div className="actions"><Button label="Cancel" onClick={() => setVoidOpen(false)} />
        <Button label="Confirm void" variant="primary" isDisabled={busy} clickAction={async () => {
          if (await mutate('void')) setVoidOpen(false)
        }} />
      </div>
    </div></Dialog>
  </div>
}
