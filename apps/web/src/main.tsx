import { Center } from '@astryxdesign/core/Center'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { Layout, LayoutContent, LayoutHeader, HStack, VStack } from '@astryxdesign/core/Layout'
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

function Frame({ account, children }: { account?: string; children: ReactNode }) {
  return <AppShell
    topNav={<TopNav heading={<TopNavHeading heading="Clausid" headingHref="/" />}
      endContent={account && <div className="actions"><Text>{account}</Text><Button label="Sign out" clickAction={async () => {
        const result = await authClient.signOut()
        if (result.error) alert(result.error.message ?? 'Sign-out failed.')
        else location.reload()
      }} /></div>} />}
    contentPadding={0}
  ><div className="page-content">{children}</div></AppShell>
}

function Credentials() {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset' | 'password'>(
    () => {
      if (location.pathname === '/reset-password') return 'password'
      const requested = new URLSearchParams(location.search).get('auth')
      return requested === 'signup' || requested === 'reset' ? requested : 'login'
    },
  )
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [emailValue, setEmailValue] = useState('')
  const [passwordValue, setPasswordValue] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const email = String(fields.get('email') ?? '')
    const password = String(fields.get('password') ?? '')
    setError('')
    setNotice('')
    setBusy(true)
    try {
      if (mode === 'reset') {
        const result = await authClient.requestPasswordReset({ email, redirectTo: location.origin + '/reset-password' })
        if (result.error) throw new Error(result.error.message)
        setNotice('Check your email for a password reset link.')
      } else if (mode === 'password') {
        const token = new URLSearchParams(location.search).get('token') ?? ''
        const result = await authClient.resetPassword({ token, newPassword: password })
        if (result.error) throw new Error(result.error.message)
        location.assign('/')
      } else if (mode === 'signup') {
        const result = await authClient.signUp.email({
          email, password, name: String(fields.get('name')), callbackURL: location.origin + location.pathname,
        })
        if (result.error) throw new Error(result.error.message)
        setNotice('Check your inbox to verify your email, then sign in.')
      } else {
        const result = await authClient.signIn.email({ email, password })
        if (result.error) throw new Error(result.error.message)
        location.reload()
      }
    } catch (reason) { setError(errorMessage(reason)) } finally { setBusy(false) }
  }
  const labels = { login: 'Sign in', signup: 'Create account', reset: 'Reset password', password: 'Set new password' }
  function changeMode(next: typeof mode) {
    setError('')
    setNotice('')
    setPasswordValue('')
    setMode(next)
  }

  // Astryx CLI 0.7.16, login-card template, connected to Better Auth.
  return <main>
    <Center axis="both" padding={6} minHeight="100dvh" style={{ backgroundColor: 'var(--color-background-body)' }}>
      <VStack gap={4} hAlign="center" width="100%" maxWidth={400}>
        <Text type="body" weight="bold" size="lg">Clausid</Text>
        <Card padding={8} width="100%">
          <VStack gap={4} hAlign="stretch">
            <VStack gap={1} hAlign="center">
              <Heading level={2} accessibilityLevel={1}>{labels[mode]}</Heading>
              {inviteMatch && <Text color="secondary" size="sm">Use the email address that received the invitation.</Text>}
            </VStack>
            <form className="template-form" onSubmit={submit}>
              <VStack gap={2} hAlign="stretch">
                {mode === 'signup' && <TextInput label="Name" isLabelHidden placeholder="Full name" size="lg" width="100%"
                  htmlName="name" autoComplete="name" isRequired {...{ required: true, maxLength: 120 }}
                  value={name} onChange={setName} />}
                {mode !== 'password' && <TextInput label="Email" isLabelHidden placeholder="name@company.com" size="lg" width="100%"
                  type="email" htmlName="email" autoComplete="email" isRequired {...{ required: true }}
                  value={emailValue} onChange={setEmailValue} />}
                {mode !== 'reset' && <TextInput label="Password" isLabelHidden placeholder="Enter your password" size="lg" width="100%"
                  type="password" htmlName="password" isRequired {...{ required: true, minLength: mode === 'login' ? undefined : 12 }}
                  value={passwordValue} onChange={setPasswordValue} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />}
                {mode === 'login' && <VStack hAlign="end">
                  <Link href="?auth=reset" size="sm" color="secondary" type="supporting" onClick={(event) => {
                    event.preventDefault()
                    changeMode('reset')
                  }}>Forgot password?</Link>
                </VStack>}
              </VStack>
              {notice && <div role="status"><Banner status="success" title={notice} /></div>}
              {error && <div role="alert"><Banner status="error" title={error} /></div>}
              <Button label={labels[mode]} type="submit" variant="primary" size="lg" width="100%" isLoading={busy} />
            </form>
            {mode !== 'password' && <VStack hAlign="center">
              <Text type="supporting" color="secondary">
                {mode === 'login' && 'Don’t have an account? '}
                <Link href={mode === 'login' ? '?auth=signup' : '?auth=login'} type="supporting" onClick={(event) => {
                  event.preventDefault()
                  changeMode(mode === 'login' ? 'signup' : 'login')
                }}>{mode === 'login' ? 'Create an account' : 'Back to sign in'}</Link>
              </Text>
            </VStack>}
          </VStack>
        </Card>
      </VStack>
    </Center>
  </main>
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
  return <Frame account={account.email}>
    {error ? <div role="alert"><Banner status="error" title={error} /></div>
      : !store ? <p role="status">Opening workspace…</p>
      : contractMatch ? <ContractPage id={contractMatch[1]} store={store} name={account.name} />
      : <Dashboard store={store} />}
  </Frame>
}

function App() {
  const session = authClient.useSession()
  if (session.isPending && !session.isRefetching) return <Frame><p role="status">Checking your session…</p></Frame>
  if (!session.data?.user.emailVerified) return <Credentials />
  if (inviteMatch && inviteKey) return <Frame account={session.data.user.email}>
    <Invitation id={inviteMatch[1]} inviteKey={inviteKey} />
  </Frame>
  return <StoreGate account={session.data.user} />
}
createRoot(document.getElementById('root')!).render(<Theme theme={neutralTheme}><App /></Theme>)
