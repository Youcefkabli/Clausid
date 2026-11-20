import { definedProps } from './defined-props.ts'
import { requiredValue } from '../../../packages/contracts/src/invariant.ts'
import { contractViewSchema, summariesSchema, workspaceSchema, workspacesSchema } from '@clausid/contracts'
import WorkspacesTable, { WorkspaceContractsTable } from './app/table-grouped/page.tsx'
import { WorkspaceParticipants } from './participants.tsx'
import { WorkspacePartiesDialog } from './workspace-parties.tsx'
import WorkspaceWizard from './app/form-wizard/page.tsx'
import LoginCard from './app/login-card/page.tsx'
import { AccountSettings } from './account-settings.tsx'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { Layout, LayoutContent, LayoutHeader, HStack, VStack } from '@astryxdesign/core/Layout'
import { AppShell } from '@astryxdesign/core/AppShell'
import { Banner } from '@astryxdesign/core/Banner'
import { Card } from '@astryxdesign/core/Card'
import { FileInput } from '@astryxdesign/core/FileInput'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Heading } from '@astryxdesign/core/Heading'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { TopNav, TopNavHeading } from '@astryxdesign/core/TopNav'
import * as stylex from '@stylexjs/stylex'
import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Button } from '@astryxdesign/core/Button'
import { Theme } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral/built'
import { titleInput, workspaceDocumentLimit } from '@clausid/contracts'
import type { Summary, Workspace } from '@clausid/contracts'
import { api, ApiError, authClient, errorMessage, workspaceApi, workspaceAction } from './api.ts'
import { openStore, project, useProjection } from './store.ts'
import type { AppStore } from './store.ts'
import { ContractPage } from './contract-page.tsx'
import { EmptyCanvas, type CanvasHeader } from './app/canvas-editor/page.tsx'
import '@astryxdesign/core/reset.css'
import '@astryxdesign/core/astryx.css'
import '@astryxdesign/theme-neutral/fonts.css'
import '@astryxdesign/theme-neutral/theme.css'
import './style.css'

// Keep old bookmarks working after consolidating the contract list into Workspaces.
if (/^\/contracts\/?$/.test(location.pathname)) {
  history.replaceState(null, '', '/')
}

const inviteMatch = location.pathname.match(/^\/(invite|workspace-invite)\/([\w-]+)$/)
const isWorkspaceInvite = inviteMatch?.[1] === 'workspace-invite'
const contractMatch = location.pathname.match(/^\/contracts\/([\w-]+)$/)
const isWorkspaceWizard = location.pathname === '/workspaces/new'
const editWorkspaceId = location.pathname.match(/^\/workspaces\/([\w-]+)\/edit\/?$/)?.[1]
const query = new URLSearchParams(location.search)
const selectedWorkspaceId = query.get('workspace')
const selectedWorkspaceSlug = query.get('workspaceSlug')
const hasWorkspaceSelection = selectedWorkspaceId !== null || selectedWorkspaceSlug !== null
const workspaceLanding = !hasWorkspaceSelection
const workspaceHref = (workspace: Workspace) =>
  workspace.slug && workspace.role !== 'member' ? '/?workspaceSlug=' + workspace.slug : '/?workspace=' + workspace.id
const inviteKey = inviteMatch && 'clausid-invite:' + inviteMatch[1] + ':' + inviteMatch[2]
if (inviteKey && location.hash) {
  const token = new URLSearchParams(location.hash.slice(1)).get('token')
  if (token) {
    sessionStorage.setItem(inviteKey, token)
  }
  history.replaceState(null, '', location.pathname)
}

const headerStyles = stylex.create({
  centeredContent: { marginInlineStart: 'auto', marginInlineEnd: 'auto' },
  pageContent: { marginInlineStart: 'auto', marginInlineEnd: 'auto', padding: 'clamp(var(--spacing-4), 4vw, var(--spacing-10))' },
  navigation: {
    minHeight: 'calc(var(--spacing-8) + var(--spacing-1))',
    paddingBlock: 'var(--spacing-0-5)',
  },
  centered: { display: 'grid', gridTemplateColumns: 'minmax(max-content, 1fr) minmax(0, auto) minmax(max-content, 1fr)' },
})

function Frame({
  account,
  children,
  editorHeader,
  fillViewport = false,
}: {
  account?: { name: string; email: string }
  children: ReactNode
  editorHeader?: CanvasHeader
  fillViewport?: boolean
}) {
  const inlineTools = editorHeader && !editorHeader.stackedTools && editorHeader.tools
  const navigation = (
    <TopNav
      heading={<TopNavHeading heading="Clausid" headingHref="/" />}
      xstyle={[headerStyles.navigation, inlineTools ? headerStyles.centered : undefined]}
      startContent={editorHeader?.start}
      centerContent={inlineTools}
      endContent={
        <>
          {editorHeader?.end}
          {account && (
            <HStack gap={1} vAlign="center" role="group" aria-label="Participants and account">
              {editorHeader?.participants}
              <AccountSettings account={account} />
            </HStack>
          )}
        </>
      }
    />
  )
  return (
    <AppShell
      variant={editorHeader ? 'section' : 'elevated'}
      mobileNav={editorHeader ? false : undefined}
      topNav={
        editorHeader?.stackedTools && editorHeader.tools ? (
          <VStack gap={0} hAlign="center" width="100%">
            {navigation}
            {editorHeader.tools}
          </VStack>
        ) : (
          navigation
        )
      }
      contentPadding={0}
    >
      {editorHeader || fillViewport ? (
        children
      ) : (
        <VStack width="100%" maxWidth={1200} gap={4} xstyle={headerStyles.pageContent}>
          {children}
        </VStack>
      )}
    </AppShell>
  )
}

function Invitation({ id, inviteKey }: { id: string; inviteKey: string }) {
  const [error, setError] = useState('')
  const token = sessionStorage.getItem(inviteKey)
  async function accept() {
    setError('')
    try {
      let destination = '/contracts/' + id
      if (isWorkspaceInvite) {
        const workspace = await workspaceAction(workspaceSchema, id, 'redeem', { token })
        destination = workspace.firstContractId ? '/contracts/' + workspace.firstContractId : '/?workspace=' + id
      } else {
        await api(contractViewSchema, '/' + id + '/redeem', { token })
      }
      sessionStorage.removeItem(inviteKey)
      location.assign(destination)
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }
  return (
    <VStack as="section" width="100%" maxWidth={440} xstyle={headerStyles.centeredContent}>
      <Card padding={5}>
        <VStack gap={4}>
          <Heading level={1}>{isWorkspaceInvite ? 'Workspace invitation' : 'Contract invitation'}</Heading>
          <Text>{token ? 'Accept to join with your verified account.' : 'Open the invitation link from your email.'}</Text>
          {error && <Banner status="error" title={error} role="alert" />}
          {token && <Button label="Accept invitation" variant="primary" clickAction={accept} />}
        </VStack>
      </Card>
    </VStack>
  )
}

function Dashboard({ store }: { store: AppStore }) {
  const row = useProjection(store, 'dashboard', summariesSchema)
  const contracts = row.kind === 'ready' ? row.data : null
  const projectionError = row.kind === 'invalid' ? row.message : ''
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const refreshContracts = () => setRefreshVersion((version) => version + 1)
  const selectedWorkspace = workspaces?.find(({ id, slug, role }) =>
    selectedWorkspaceSlug !== null ? slug === selectedWorkspaceSlug && role !== 'member' : id === selectedWorkspaceId,
  )
  const workspaceIds = new Set(workspaces?.map(({ id }) => id))
  const contractsByWorkspace = new Map<string, Summary[]>()
  const otherContracts: Summary[] = []
  for (const contract of contracts ?? []) {
    const { workspaceId } = contract
    if (!workspaceId || !workspaceIds.has(workspaceId)) {
      otherContracts.push(contract)
      continue
    }
    const group = contractsByWorkspace.get(workspaceId)
    if (group) {
      group.push(contract)
    } else {
      contractsByWorkspace.set(workspaceId, [contract])
    }
  }
  const visibleContracts = selectedWorkspace && contracts ? (contractsByWorkspace.get(selectedWorkspace.id) ?? []) : null
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [titleValue, setTitleValue] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createError, setCreateError] = useState('')
  const [createId, setCreateId] = useState(() => crypto.randomUUID())
  function changeCreateOpen(open: boolean) {
    if (creating) {
      return
    }
    setCreateOpen(open)
    if (open) {
      setTitleValue('')
      setFile(null)
      setCreateError('')
      setCreateId(crypto.randomUUID())
    }
  }
  useEffect(() => {
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const [items, spaces] = await Promise.all([api(summariesSchema, '', undefined, abort.signal), workspaceApi(workspacesSchema, undefined, abort.signal)])
        if (abort.signal.aborted) {
          return
        }
        project(store, 'dashboard', items)
        setWorkspaces(spaces)
        setError('')
      } catch (reason) {
        if (abort.signal.aborted) {
          return
        }
        if (reason instanceof ApiError && reason.status === 401) {
          location.reload()
          return
        }
        setError(errorMessage(reason))
      }
      if (!abort.signal.aborted) {
        timer = setTimeout(() => {
          void refresh()
        }, 5_000)
      }
    }
    void refresh()
    return () => {
      abort.abort()
      clearTimeout(timer)
    }
  }, [store, refreshVersion])
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (selectedWorkspace?.role !== 'owner') {
      return
    }
    const fallback =
      file?.name
        .replace(/\.pdf$/i, '')
        .trim()
        .slice(0, 160) || 'Contract'
    const title = titleInput.safeParse(titleValue.trim() || (file ? fallback : ''))
    if (!title.success) {
      setCreateError('Enter a contract title or choose a PDF.')
      return
    }
    setCreating(true)
    setCreateError('')
    try {
      let document
      if (file) {
        const { prepareWorkspaceDocument } = await import('./workspace-document.ts')
        document = await prepareWorkspaceDocument(file)
      }
      const contract = await api(contractViewSchema, '', {
        title: title.data,
        requestId: createId,
        workspaceId: selectedWorkspace.id,
        document,
      })
      location.assign('/contracts/' + contract.id)
    } catch (reason) {
      setCreateError(errorMessage(reason))
      setCreating(false)
    }
  }
  if (workspaceLanding) {
    return (
      <WorkspacesTable
        workspaces={workspaces}
        contractsByWorkspace={contracts === null ? null : contractsByWorkspace}
        otherContracts={otherContracts}
        workspaceHref={workspaceHref}
        error={error}
        onContractSaved={refreshContracts}
        onWorkspaceSaved={(saved) =>
          setWorkspaces((previous) => {
            if (!previous) {
              return [saved]
            }
            return previous.some((item) => item.id === saved.id) ? previous.map((item) => (item.id === saved.id ? saved : item)) : [saved, ...previous]
          })
        }
        onWorkspaceDeleted={(id) => setWorkspaces((previous) => previous?.filter((item) => item.id !== id) ?? null)}
      />
    )
  }

  // Astryx CLI 0.7.16, table template, using the live contract projection.
  const empty = selectedWorkspace && visibleContracts?.length === 0
  return (
    <>
      <Layout
        height="fill"
        header={
          <LayoutHeader hasDivider padding={4}>
            <HStack vAlign="center" hAlign="between" wrap="wrap" gap={3}>
              <VStack gap={1}>
                <Heading level={1}>{selectedWorkspace?.name ?? 'Workspace'}</Heading>
                {selectedWorkspace?.project && (
                  <Text as="p" color="secondary">
                    Project · {selectedWorkspace.project}
                  </Text>
                )}
                {selectedWorkspace?.description && (
                  <Text as="p" color="secondary">
                    {selectedWorkspace.description}
                  </Text>
                )}
              </VStack>
              <HStack gap={2} wrap="wrap" vAlign="center">
                <Button label="Workspaces" href="/" />
                {selectedWorkspace?.role === 'owner' && selectedWorkspace.documentName && (
                  <Button label={'Download ' + selectedWorkspace.documentName} href={'/api/workspaces/' + selectedWorkspace.id + '/document'} />
                )}
                {selectedWorkspace && <WorkspaceParticipants key={selectedWorkspace.id} workspaceId={selectedWorkspace.id} />}
                {selectedWorkspace && <WorkspacePartiesDialog workspace={selectedWorkspace} />}
                {selectedWorkspace?.role === 'owner' && <Button label="Add document" variant="primary" onClick={() => changeCreateOpen(true)} />}
              </HStack>
            </HStack>
          </LayoutHeader>
        }
        content={
          <LayoutContent {...definedProps({ padding: empty ? 0 : undefined })}>
            {empty ? (
              <>
                {(error || projectionError) && <Banner status="error" title={error || projectionError} role="alert" />}
                <EmptyCanvas member={selectedWorkspace.role === 'member'} />
              </>
            ) : (
              <VStack gap={5}>
                {(error || projectionError) && <Banner status="error" title={error || projectionError} role="alert" />}
                {workspaces && !selectedWorkspace ? (
                  <EmptyState title="Workspace unavailable" />
                ) : visibleContracts === null ? (
                  <Text role="status">Loading contracts…</Text>
                ) : (
                  <WorkspaceContractsTable contracts={visibleContracts} canManage={selectedWorkspace?.role === 'owner'} onSaved={refreshContracts} />
                )}
              </VStack>
            )}
          </LayoutContent>
        }
      />
      <Dialog isOpen={createOpen} onOpenChange={changeCreateOpen} purpose="form">
        <Layout
          header={<DialogHeader title="Add document" onOpenChange={changeCreateOpen} />}
          content={
            <LayoutContent>
              <form onSubmit={create}>
                <VStack gap={3}>
                  <FileInput
                    label="PDF document"
                    mode="dropzone"
                    accept=".pdf,application/pdf"
                    maxSize={workspaceDocumentLimit}
                    value={file}
                    isDisabled={creating}
                    description="PDF with selectable text, up to 1 MB."
                    onChange={(value) => {
                      setFile(Array.isArray(value) ? (value[0] ?? null) : value)
                      setCreateError('')
                    }}
                  />
                  <TextInput
                    label="Contract title"
                    placeholder={file ? file.name.replace(/\.pdf$/i, '') : 'e.g. Services agreement'}
                    width="100%"
                    value={titleValue}
                    onChange={setTitleValue}
                    isRequired={!file}
                    isDisabled={creating}
                  />
                  {createError && <Banner status="error" title={createError} role="alert" />}
                  <HStack hAlign="end" gap={2}>
                    <Button label="Cancel" isDisabled={creating} onClick={() => changeCreateOpen(false)} />
                    <Button label={file ? 'Upload PDF' : 'Create contract'} type="submit" variant="primary" isLoading={creating} />
                  </HStack>
                </VStack>
              </form>
            </LayoutContent>
          }
        />
      </Dialog>
    </>
  )
}

function StoreGate({ account }: { account: { id: string; name: string; email: string } }) {
  const [store, setStore] = useState<AppStore>()
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    let current: AppStore | undefined
    void openStore()
      .then((result) => {
        if (active) {
          current = result
          setStore(result)
        } else {
          void result.shutdownPromise()
        }
      })
      .catch((reason) => {
        if (active) {
          setError(errorMessage(reason))
        }
      })
    return () => {
      active = false
      if (current) {
        void current.shutdownPromise()
      }
    }
  }, [])
  if (store && contractMatch) {
    return (
      <ContractPage
        id={requiredValue(contractMatch[1])}
        store={store}
        account={account}
        renderPage={(content, editorHeader) => (
          <Frame account={account} {...definedProps({ editorHeader: editorHeader })}>
            {content}
          </Frame>
        )}
      />
    )
  }
  return (
    <Frame account={account} fillViewport={Boolean(store)}>
      {error ? <Banner status="error" title={error} role="alert" /> : !store ? <Text role="status">Opening workspace…</Text> : <Dashboard store={store} />}
    </Frame>
  )
}

function EditWorkspace({ id }: { id: string }) {
  const [workspace, setWorkspace] = useState<Workspace | null>()
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void workspaceApi(workspacesSchema, undefined, controller.signal)
      .then((workspaces) => {
        if (!controller.signal.aborted) {
          setWorkspace(workspaces.find((item) => item.id === id && item.role === 'owner') ?? null)
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(errorMessage(reason))
        }
      })
    return () => controller.abort()
  }, [id])
  if (workspace) {
    return <WorkspaceWizard workspace={workspace} />
  }
  if (error) {
    return <Banner status="error" title={error} role="alert" />
  }
  if (workspace === null) {
    return <EmptyState title="Workspace unavailable" actions={<Button label="Workspaces" href="/" />} />
  }
  return <Text role="status">Loading workspace…</Text>
}

function App() {
  const session = authClient.useSession()
  if (location.pathname === '/reset-password') {
    return <LoginCard invitation={false} />
  }
  if (session.isPending && !session.isRefetching) {
    return (
      <Frame>
        <Text role="status">Checking your session…</Text>
      </Frame>
    )
  }
  if (session.error && !session.data) {
    return (
      <Frame>
        <Banner status="error" title="Could not check your session." />
        <Button label="Retry" onClick={() => void session.refetch()} />
      </Frame>
    )
  }
  if (!session.data?.user.emailVerified) {
    return <LoginCard invitation={Boolean(inviteMatch)} />
  }
  if (inviteMatch && inviteKey) {
    return (
      <Frame account={session.data.user}>
        <Invitation id={requiredValue(inviteMatch[2])} inviteKey={inviteKey} />
      </Frame>
    )
  }
  if (editWorkspaceId) {
    return (
      <Frame account={session.data.user}>
        <EditWorkspace key={session.data.user.id + ':' + editWorkspaceId} id={editWorkspaceId} />
      </Frame>
    )
  }
  if (isWorkspaceWizard) {
    return (
      <Frame account={session.data.user}>
        <WorkspaceWizard />
      </Frame>
    )
  }
  return <StoreGate key={session.data.user.id} account={session.data.user} />
}
createRoot(requiredValue(document.getElementById('root'))).render(
  <Theme theme={neutralTheme}>
    <App />
  </Theme>,
)
