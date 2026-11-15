import { WorkspacePartiesDialog } from './workspace-parties.tsx'
import WorkspaceWizard from './app/form-wizard/page.tsx'
import LoginCard from './app/login-card/page.tsx'
import { AccountSettings } from './account-settings.tsx'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { Layout, LayoutContent, LayoutHeader, HStack } from '@astryxdesign/core/Layout'
import { Table } from '@astryxdesign/core/Table'
import type { TableColumn } from '@astryxdesign/core/Table'
import { AppShell } from '@astryxdesign/core/AppShell'
import { Badge } from '@astryxdesign/core/Badge'
import { Banner } from '@astryxdesign/core/Banner'
import { Card } from '@astryxdesign/core/Card'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Heading } from '@astryxdesign/core/Heading'
import { Link } from '@astryxdesign/core/Link'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { TopNav, TopNavHeading } from '@astryxdesign/core/TopNav'
import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Button } from '@astryxdesign/core/Button'
import { Theme } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral/built'
import type { ContractView, Summary, Workspace } from '@clausid/contracts'
import { api, ApiError, authClient, errorMessage, workspaceApi, workspaceAction } from './api.ts'
import { openStore, project, useProjection } from './store.ts'
import { statusVariant } from './status.ts'
import type { AppStore } from './store.ts'
import { ContractPage } from './contract-page.tsx'
import type { CanvasHeader } from './app/canvas-editor/page.tsx'
import '@astryxdesign/core/reset.css'
import '@astryxdesign/core/astryx.css'
import '@astryxdesign/theme-neutral/fonts.css'
import '@astryxdesign/theme-neutral/theme.css'
import './style.css'

const inviteMatch = location.pathname.match(/^\/(invite|workspace-invite)\/([\w-]+)$/)
const isWorkspaceInvite = inviteMatch?.[1] === 'workspace-invite'
const contractMatch = location.pathname.match(/^\/contracts\/([\w-]+)$/)
const isWorkspaceWizard = location.pathname === '/workspaces/new'
const query = new URLSearchParams(location.search)
const selectedWorkspaceId = query.get('workspace')
const selectedWorkspaceSlug = query.get('workspaceSlug')
const hasWorkspaceSelection = selectedWorkspaceId !== null || selectedWorkspaceSlug !== null
const workspaceLanding = !hasWorkspaceSelection && location.pathname !== '/contracts'
const workspaceHref = (workspace: Workspace) => workspace.slug && workspace.role !== 'member'
  ? '/?workspaceSlug=' + workspace.slug : '/?workspace=' + workspace.id
const inviteKey = inviteMatch && 'clausid-invite:' + inviteMatch[1] + ':' + inviteMatch[2]
if (inviteKey && location.hash) {
  const token = new URLSearchParams(location.hash.slice(1)).get('token')
  if (token) sessionStorage.setItem(inviteKey, token)
  history.replaceState(null, '', location.pathname)
}

function Frame({ account, children, editorHeader }: {
  account?: { name: string; email: string }
  children: ReactNode
  editorHeader?: CanvasHeader
}) {
  return <AppShell
    topNav={<TopNav heading={<TopNavHeading heading="Clausid" headingHref="/" />}
      startContent={editorHeader?.start}
      endContent={<>{editorHeader?.end}{account && <AccountSettings account={account} compact={editorHeader?.compact} />}</>} />}
    contentPadding={0}
  >{editorHeader ? children : <div className="page-content">{children}</div>}</AppShell>
}

function Invitation({ id, inviteKey }: { id: string; inviteKey: string }) {
  const [error, setError] = useState('')
  const token = sessionStorage.getItem(inviteKey)
  async function accept() {
    setError('')
    try {
      if (isWorkspaceInvite) await workspaceAction(id, 'redeem', { token })
      else await api('/' + id + '/redeem', { token })
      sessionStorage.removeItem(inviteKey)
      location.assign(isWorkspaceInvite ? '/?workspace=' + id : '/contracts/' + id)
    } catch (reason) { setError(errorMessage(reason)) }
  }
  return <section className="auth-panel"><Card padding={5}><div className="flow">
    <Heading level={1}>{isWorkspaceInvite ? 'Workspace invitation' : 'Contract invitation'}</Heading>
    <p>{token ? 'Accept to join with your verified account.' : 'Open the invitation link from your email.'}</p>
    {error && <div role="alert"><Banner status="error" title={error} /></div>}
    {token && <Button label="Accept invitation" variant="primary" clickAction={accept} />}
  </div></Card></section>
}

const contractColumns: TableColumn<Summary>[] = [
  { key: 'title', header: 'Contract', renderCell: ({ id, title }) => <Link href={'/contracts/' + id} weight="semibold">{title}</Link> },
  { key: 'status', header: 'Status', renderCell: ({ status }) => <Badge label={status} variant={statusVariant[status]} /> },
  { key: 'role', header: 'Role', renderCell: ({ role }) => <Text color="secondary">{role}</Text> },
]

function Dashboard({ store }: { store: AppStore }) {
  const row = useProjection(store, 'dashboard')
  const contracts = row ? JSON.parse(row.value) as Summary[] : null
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null)
  const selectedWorkspace = workspaces?.find(({ id, slug, role }) =>
    selectedWorkspaceSlug !== null ? slug === selectedWorkspaceSlug && role !== 'member' : id === selectedWorkspaceId)
  const visibleContracts = selectedWorkspace
    ? contracts?.filter(({ workspaceId }) => workspaceId === selectedWorkspace.id) ?? null
    : contracts
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [titleValue, setTitleValue] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createError, setCreateError] = useState('')
  const [createId, setCreateId] = useState(() => crypto.randomUUID())
  function changeCreateOpen(open: boolean) {
    if (creating) return
    setCreateOpen(open)
    if (open) {
      setTitleValue('')
      setCreateError('')
      setCreateId(crypto.randomUUID())
    }
  }
  useEffect(() => {
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const [items, spaces] = await Promise.all([
          api<Summary[]>('', undefined, abort.signal),
          workspaceApi<Workspace[]>(undefined, abort.signal),
        ])
        if (abort.signal.aborted) return
        project(store, 'dashboard', items)
        setWorkspaces(spaces)
        setError('')
      } catch (reason) {
        if (abort.signal.aborted) return
        if (reason instanceof ApiError && reason.status === 401) { location.reload(); return }
        setError(errorMessage(reason))
      }
      if (!abort.signal.aborted) timer = setTimeout(refresh, 5_000)
    }
    void refresh()
    return () => { abort.abort(); clearTimeout(timer) }
  }, [store])
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = String(new FormData(event.currentTarget).get('title'))
    setCreating(true)
    setCreateError('')
    try {
      const contract = await api<ContractView>('', { title, requestId: createId, workspaceId: selectedWorkspace?.id })
      location.assign('/contracts/' + contract.id)
    } catch (reason) { setCreateError(errorMessage(reason)); setCreating(false) }
  }
  // Astryx CLI 0.7.16, table template, using the live contract projection.
  return <>
    <Layout header={<LayoutHeader hasDivider>
      <HStack vAlign="center" hAlign="between">
        <Heading level={1}>{workspaceLanding ? 'Workspaces' : 'Contracts'}</Heading>
        <div className="actions">
          {workspaceLanding ? <>
            <Button label="All contracts" href="/contracts" />
            <Button label="New workspace" href="/workspaces/new" variant="primary" />
          </> : <>
            <Button label="Workspaces" href="/" />
            {selectedWorkspace && <WorkspacePartiesDialog workspace={selectedWorkspace} />}
            {(!hasWorkspaceSelection || selectedWorkspace?.role === 'owner') &&
              <Button label={selectedWorkspace ? 'Add document' : 'New contract'} variant="primary"
                onClick={() => changeCreateOpen(true)} />}
          </>}
        </div>
      </HStack>
    </LayoutHeader>} content={<LayoutContent>
      <div className="flow">
        {error && <div role="alert"><Banner status="error" title={error} /></div>}
        {workspaceLanding && (workspaces === null ? <Text role="status">Loading workspaces…</Text>
          : workspaces.length === 0 ? <EmptyState title="No workspaces yet"
            description="Create a workspace or accept an invitation from another party." />
          : workspaces.map((workspace) => <Card key={workspace.id} padding={4}>
            <div className="flow">
              <Link href={workspaceHref(workspace)} weight="semibold">{workspace.name}</Link>
              {workspace.description && <Text color="secondary">{workspace.description}</Text>}
              <Badge label={workspace.role === 'member' ? 'Invited party' : 'Service provider'} variant="neutral" />
            </div>
          </Card>))}
        {selectedWorkspace && <div>
          <Heading level={2}>{selectedWorkspace.name}</Heading>
          {selectedWorkspace.description && <Text as="p" color="secondary">{selectedWorkspace.description}</Text>}
        </div>}
        {!workspaceLanding && (hasWorkspaceSelection && workspaces && !selectedWorkspace ? <EmptyState title="Workspace unavailable"
          actions={<Button label="Back to contracts" href="/" />} />
          : visibleContracts === null ? <Text role="status">Loading contracts…</Text>
          : visibleContracts.length === 0 ? <EmptyState title="No contracts yet"
            description={selectedWorkspace?.role === 'member' ? 'Contracts appear here when the service provider shares them.'
              : selectedWorkspace ? 'Create the first contract in this workspace.' : 'Create a contract or accept an invitation to get started.'} />
          : <Table<Summary> data={visibleContracts} columns={contractColumns} idKey="id" hasHover aria-label="Your contracts" />)}
      </div>
    </LayoutContent>} />
    <Dialog isOpen={createOpen} onOpenChange={changeCreateOpen} purpose="form" padding={0}>
      <Layout header={<DialogHeader title={selectedWorkspace ? 'Add document' : 'New contract'} onOpenChange={changeCreateOpen} />} content={<LayoutContent>
        <form onSubmit={create} className="template-form">
          <TextInput label="Contract title" htmlName="title" placeholder="e.g. Services agreement" width="100%"
            isRequired {...{ required: true, maxLength: 160 }} value={titleValue} onChange={setTitleValue} />
          {createError && <div role="alert"><Banner status="error" title={createError} /></div>}
          <HStack hAlign="end" gap={2}>
            <Button label="Cancel" isDisabled={creating} onClick={() => changeCreateOpen(false)} />
            <Button label="Create contract" type="submit" variant="primary" isLoading={creating} />
          </HStack>
        </form>
      </LayoutContent>} />
    </Dialog>
  </>
}

function StoreGate({ account }: { account: { name: string; email: string } }) {
  const [store, setStore] = useState<AppStore>()
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    let current: AppStore | undefined
    void openStore().then((result) => {
      if (active) { current = result; setStore(result) }
      else void result.shutdownPromise()
    }).catch((reason) => { if (active) setError(errorMessage(reason)) })
    return () => { active = false; if (current) void current.shutdownPromise() }
  }, [])
  if (store && contractMatch) {
    return <ContractPage id={contractMatch[1]} store={store} account={account}
      renderPage={(content, editorHeader) => <Frame account={account} editorHeader={editorHeader}>{content}</Frame>} />
  }
  return <Frame account={account}>
    {error ? <div role="alert"><Banner status="error" title={error} /></div>
      : !store ? <p role="status">Opening workspace…</p>
      : <Dashboard store={store} />}
  </Frame>
}

function App() {
  const session = authClient.useSession()
  if (session.isPending && !session.isRefetching) return <Frame><p role="status">Checking your session…</p></Frame>
  if (!session.data?.user.emailVerified) return <LoginCard invitation={Boolean(inviteMatch)} />
  if (inviteMatch && inviteKey) return <Frame account={session.data.user}>
    <Invitation id={inviteMatch[2]} inviteKey={inviteKey} />
  </Frame>
  if (isWorkspaceWizard) return <Frame account={session.data.user}><WorkspaceWizard /></Frame>
  return <StoreGate account={session.data.user} />
}
createRoot(document.getElementById('root')!).render(<Theme theme={neutralTheme}><App /></Theme>)
