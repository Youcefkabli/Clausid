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
import type { ContractView, Summary } from '@clausid/contracts'
import { api, ApiError, authClient, errorMessage } from './api.ts'
import { openStore, project, useProjection } from './store.ts'
import { statusVariant } from './status.ts'
import type { AppStore } from './store.ts'
import { ContractPage } from './contract-page.tsx'
import '@astryxdesign/core/reset.css'
import '@astryxdesign/core/astryx.css'
import '@astryxdesign/theme-neutral/fonts.css'
import '@astryxdesign/theme-neutral/theme.css'
import './style.css'

const inviteMatch = location.pathname.match(/^\/invite\/([\w-]+)$/)
const contractMatch = location.pathname.match(/^\/contracts\/([\w-]+)$/)
const inviteKey = inviteMatch && 'clausid-invite:' + inviteMatch[1]
if (inviteKey && location.hash) {
  const token = new URLSearchParams(location.hash.slice(1)).get('token')
  if (token) sessionStorage.setItem(inviteKey, token)
  history.replaceState(null, '', location.pathname)
}

function Frame({ account, children }: { account?: { name: string; email: string }; children: ReactNode }) {
  return <AppShell
    topNav={<TopNav heading={<TopNavHeading heading="Clausid" headingHref="/" />}
      endContent={account && <AccountSettings account={account} />} />}
    contentPadding={0}
  ><div className="page-content">{children}</div></AppShell>
}

function Invitation({ id, inviteKey }: { id: string; inviteKey: string }) {
  const [error, setError] = useState('')
  const token = sessionStorage.getItem(inviteKey)
  async function accept() {
    setError('')
    try {
      await api('/' + id + '/redeem', { token })
      sessionStorage.removeItem(inviteKey)
      location.assign('/contracts/' + id)
    } catch (reason) { setError(errorMessage(reason)) }
  }
  return <section className="auth-panel"><Card padding={5}><div className="flow">
    <Heading level={1}>Contract invitation</Heading>
    <p>{token ? 'Accept to open the contract with your verified account.' : 'Open the invitation link from your email.'}</p>
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
        project(store, 'dashboard', await api<Summary[]>('', undefined, abort.signal))
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
      const contract = await api<ContractView>('', { title, requestId: createId })
      location.assign('/contracts/' + contract.id)
    } catch (reason) { setCreateError(errorMessage(reason)); setCreating(false) }
  }
  // Astryx CLI 0.7.16, table template, using the live contract projection.
  return <>
    <Layout header={<LayoutHeader hasDivider>
      <HStack vAlign="center" hAlign="between">
        <Heading level={1}>Contracts</Heading>
        <Button label="New contract" variant="primary" onClick={() => changeCreateOpen(true)} />
      </HStack>
    </LayoutHeader>} content={<LayoutContent>
      {error && <div role="alert"><Banner status="error" title={error} /></div>}
      {contracts === null ? <Text role="status">Loading contracts…</Text>
        : contracts.length === 0 ? <EmptyState title="No contracts yet" description="Create a contract or accept an invitation to get started." />
        : <Table<Summary> data={contracts} columns={contractColumns} idKey="id" hasHover aria-label="Your contracts" />}
    </LayoutContent>} />
    <Dialog isOpen={createOpen} onOpenChange={changeCreateOpen} purpose="form" padding={0}>
      <Layout header={<DialogHeader title="New contract" onOpenChange={changeCreateOpen} />} content={<LayoutContent>
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
  return <Frame account={account}>
    {error ? <div role="alert"><Banner status="error" title={error} /></div>
      : !store ? <p role="status">Opening workspace…</p>
      : contractMatch ? <ContractPage id={contractMatch[1]} store={store} name={account.name} />
      : <Dashboard store={store} />}
  </Frame>
}

function App() {
  const session = authClient.useSession()
  if (session.isPending && !session.isRefetching) return <Frame><p role="status">Checking your session…</p></Frame>
  if (!session.data?.user.emailVerified) return <LoginCard invitation={Boolean(inviteMatch)} />
  if (inviteMatch && inviteKey) return <Frame account={session.data.user}>
    <Invitation id={inviteMatch[1]} inviteKey={inviteKey} />
  </Frame>
  return <StoreGate account={session.data.user} />
}
createRoot(document.getElementById('root')!).render(<Theme theme={neutralTheme}><App /></Theme>)
