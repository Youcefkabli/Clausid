// Copyright (c) Meta Platforms, Inc. and affiliates.
// Adapted from the Astryx CLI table-grouped template.

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Avatar } from '@astryxdesign/core/Avatar'
import { Badge } from '@astryxdesign/core/Badge'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { HStack, Layout, LayoutContent, LayoutHeader, LayoutPanel, StackItem, VStack } from '@astryxdesign/core/Layout'
import { Link } from '@astryxdesign/core/Link'
import { Icon } from '@astryxdesign/core/Icon'
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList'
import { Divider } from '@astryxdesign/core/Divider'
import { Popover } from '@astryxdesign/core/Popover'
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList'
import { ResizeHandle, useResizable } from '@astryxdesign/core/Resizable'
import { Selector } from '@astryxdesign/core/Selector'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { pixel, proportional, Table, useTableGroupedRows } from '@astryxdesign/core/Table'
import type { TableColumn, TablePlugin } from '@astryxdesign/core/Table'
import { Heading, Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { useMediaQuery } from '@astryxdesign/core/hooks'
import { X } from 'lucide-react'
import { ArrowRightIcon, DocumentDuplicateIcon, EllipsisHorizontalIcon, PencilIcon, TagIcon, TrashIcon, UserIcon } from '@heroicons/react/24/outline'
import { rtlStyles } from '@astryxdesign/core/utils'
import type { Summary, Workspace, WorkspaceParties } from '@clausid/contracts'
import { workspaceProject, workspaceStatuses } from '@clausid/contracts'
import { workspaceAction, workspaceApi, errorMessage } from '../../api.ts'
import { statusVariant } from '../../status.ts'

const contractRole: Record<Summary['role'], string> = { owner: 'Owner', editor: 'Collaborator', signer: 'Signer' }
type WorkspaceStatus = NonNullable<Workspace['status']>
const statusFilters = ['All', 'Draft', 'Review', 'Negotiation', 'Signature', 'Active', 'Expiring', 'Closed'] as const satisfies readonly ('All' | WorkspaceStatus)[]
const workspaceVariant = {
  Draft: 'neutral',
  Review: 'warning',
  Negotiation: 'warning',
  Signature: 'warning',
  Active: 'success',
  Expiring: 'warning',
  'On hold': 'warning',
  Closed: 'neutral',
  Completed: 'neutral',
} as const satisfies Record<WorkspaceStatus, string>
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
const dateLabel = (value?: number) => value === undefined ? '—' : dateFormat.format(value)
function inferWorkspaceStatus(contracts: Summary[] | undefined): WorkspaceStatus {
  if (!contracts?.length) return 'Draft'
  if (contracts.some(contract => contract.status === 'Awaiting signatures')) return 'Signature'
  if (contracts.some(contract => contract.status === 'Draft')) return 'Draft'
  if (contracts.some(contract => contract.status === 'Signed')) return 'Active'
  return 'Closed'
}
const workspaceRole = (workspace: Workspace) => workspace.role === 'member' ? 'Invited party' : 'Service provider'

function StatusLabel({ label, variant }: { label: string; variant: 'success' | 'warning' | 'error' | 'neutral' }) {
  return <HStack gap={1.5} vAlign="center">
    <StatusDot variant={variant} label={label} aria-hidden />
    <Text>{label}</Text>
  </HStack>
}

export const contractColumns: TableColumn<Summary>[] = [
  { key: 'title', header: 'Contract', width: proportional(2), renderCell: ({ id, title }) =>
    <Link href={'/contracts/' + id} weight="semibold">{title}</Link> },
  { key: 'status', header: 'Status', width: proportional(1, { minWidth: 148 }), renderCell: ({ status }) =>
    <StatusLabel label={status} variant={statusVariant[status]} /> },
  { key: 'role', header: 'Role', width: proportional(1), renderCell: ({ role }) => <Text color="secondary">{contractRole[role]}</Text> },
]

const workspaceActionTitle = { edit: 'Edit workspace', assign: 'Assign to…', label: 'Add label', duplicate: 'Duplicate workspace', move: 'Move to project' } as const
type WorkspaceAction = keyof typeof workspaceActionTitle
const projectOptionValue = (project?: string | null) => project ? 'project:' + project : 'unassigned'

function CustomizeWorkspace({ workspace, currentStatus, projectAssignments, action, close, onSaved }: {
  projectAssignments: { value: string; label: string }[];
  currentStatus: WorkspaceStatus;
  workspace: Workspace; action: WorkspaceAction; close: () => void; onSaved: (workspace: Workspace) => void
}) {
  const [name, setName] = useState(action === 'duplicate' ? (workspace.name.slice(0, 153) + ' (copy)') : workspace.name)
  const [label, setLabel] = useState('')
  const [requestId] = useState(() => crypto.randomUUID())
  const [description, setDescription] = useState(workspace.description)
  const [project, setProject] = useState(workspace.project ?? '')
  const projectUnchanged = project === (workspace.project ?? '')
  const projectInvalid = !workspaceProject.safeParse(project).success
  const [status, setStatus] = useState<WorkspaceStatus>(currentStatus)
  const [assignee, setAssignee] = useState(workspace.assignee?.email ?? '')
  const [parties, setParties] = useState<WorkspaceParties['parties']>()
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (action !== 'assign') return
    const abort = new AbortController()
    void workspaceAction<WorkspaceParties>(workspace.id, 'parties', undefined, abort.signal).then(result => {
      if (abort.signal.aborted) return
      setParties(result.parties)
      setAssignee(current => current || result.parties[0]?.email || '')
    }).catch(reason => { if (!abort.signal.aborted) setError(errorMessage(reason)) })
    return () => abort.abort()
  }, [workspace.id, action])
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const party = parties?.find(person => person.email === assignee)
    if (saving || (action === 'assign' && !party) || (action === 'move' && projectUnchanged)) return
    setSaving(true)
    setError('')
    try {
      if (action === 'duplicate') {
        const result = await workspaceApi<Workspace>({ name, description, project, requestId })
        onSaved({ ...result, role: 'owner' })
      } else {
        const fields = action === 'label' ? { label }
          : action === 'assign' ? { assigneeId: party?.id }
          : action === 'move' ? { project }
          : { name, description, project, ...(status !== currentStatus ? { status } : {}) }
        const result = await workspaceAction<Workspace>(workspace.id, 'customize', fields)
        onSaved({ ...workspace, ...result })
      }
      close()
    } catch (reason) {
      setSaving(false)
      setError(errorMessage(reason))
    }
  }
  return <Dialog isOpen onOpenChange={open => { if (!open && !saving) close() }} purpose="form" padding={0}>
    <Layout header={<DialogHeader title={workspaceActionTitle[action]} onOpenChange={open => { if (!open && !saving) close() }} />}
      content={<LayoutContent padding={4}>
        <form onSubmit={save}>
          {(action === 'edit' || action === 'duplicate') && <>
            <TextInput label="Workspace name" value={name} onChange={setName} isRequired width="100%" />
            <TextInput label="Project" value={project} onChange={setProject} width="100%"
              status={projectInvalid ? { type: 'error', message: 'Use up to 160 characters for the project name.' } : undefined} />
            <TextArea label="Description" value={description} onChange={setDescription} width="100%" rows={3} />
          </>}
          {action === 'duplicate' && <Text color="secondary">Creates a new workspace with these details.</Text>}
          {action === 'edit' && <Selector label="Status" value={status} options={[...workspaceStatuses]} onChange={value => {
            const selected = workspaceStatuses.find(item => item === value)
            if (selected) setStatus(selected)
          }} />}
          {action === 'assign' && <Selector label="Assignee" value={assignee} options={parties?.map(party => party.email) ?? []}
            onChange={setAssignee} isDisabled={!parties} />}
          {action === 'move' && <Selector label="Project" value={projectOptionValue(project)} options={projectAssignments}
            onChange={value => setProject(value === 'unassigned' ? '' : value.slice('project:'.length))} />}
          {action === 'label' && <TextInput label="Label" value={label} onChange={setLabel} isRequired width="100%" />}
          {error && <Banner role="alert" status="error" title={error} />}
          <HStack gap={2}>
            <Button label="Cancel" onClick={close} isDisabled={saving} />
            <Button label={action === 'duplicate' ? 'Duplicate' : 'Save changes'} type="submit" variant="primary" isLoading={saving}
              isDisabled={action === 'assign' ? !parties || !assignee
                : action === 'label' ? !label.trim()
                : action === 'move' ? projectUnchanged
                : !name.trim() || projectInvalid} />
          </HStack>
        </form>
      </LayoutContent>} />
  </Dialog>
}

function DeleteWorkspace({ workspace, close, onDeleted }: {
  workspace: Workspace; close: () => void; onDeleted: (id: string) => void
}) {
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  async function remove() {
    setDeleting(true)
    setError('')
    try {
      await workspaceAction(workspace.id, 'delete', {})
      onDeleted(workspace.id)
      close()
    } catch (reason) {
      setError(errorMessage(reason))
      setDeleting(false)
    }
  }
  const onOpenChange = (open: boolean) => { if (!open && !deleting) close() }
  return <Dialog isOpen onOpenChange={onOpenChange} purpose="form" padding={0}>
    <Layout header={<DialogHeader title="Delete workspace" onOpenChange={onOpenChange} />}
      content={<LayoutContent padding={4}>
        <VStack gap={3}>
          <Text>Delete {workspace.name}? Only empty, unshared workspaces can be deleted.</Text>
          {error && <Banner role="alert" status="error" title={error} />}
          <HStack gap={2}>
            <Button label="Cancel" onClick={close} isDisabled={deleting} />
            <Button label="Delete workspace" variant="destructive" isLoading={deleting} clickAction={remove} />
          </HStack>
        </VStack>
      </LayoutContent>} />
  </Dialog>
}

export default function WorkspacesTable({ workspaces, contractsByWorkspace, otherContracts, workspaceHref, error, onWorkspaceSaved, onWorkspaceDeleted }: {
  workspaces: Workspace[] | null
  contractsByWorkspace: Map<string, Summary[]> | null
  otherContracts: Summary[]
  workspaceHref: (workspace: Workspace) => string
  error: string
  onWorkspaceSaved: (workspace: Workspace) => void
  onWorkspaceDeleted: (id: string) => void
}) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<typeof statusFilters[number]>('All')
  const [projectFilter, setProjectFilter] = useState('all')
  const [selectedId, setSelectedId] = useState<string>()
  const [action, setAction] = useState<{ id: string; kind: WorkspaceAction | 'delete' }>()
  const [groupBy, setGroupBy] = useState<'status' | 'project' | 'none'>('none')
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set<string>())
  const panel = useResizable({ defaultSize: 360, minSize: 280, maxSize: 500 })
  const narrow = useMediaQuery('(max-width: 780px)')
  const selected = workspaces?.find(workspace => workspace.id === selectedId)
  const customizing = workspaces?.find(workspace => workspace.id === action?.id && workspace.role === 'owner')
  const statusOf = (workspace: Workspace) => workspace.status ?? inferWorkspaceStatus(contractsByWorkspace?.get(workspace.id))
  const projects = [...new Set(workspaces?.flatMap(({ project }) => project ? [project] : []))]
    .sort((a, b) => a.localeCompare(b))
  let unassignedProject = 'No project'
  while (projects.includes(unassignedProject)) unassignedProject += ' (unassigned)'
  const assignedProjects = projects.map(project => ({ value: projectOptionValue(project), label: project }))
  const noProject = { value: 'unassigned', label: unassignedProject }
  const projectOptions = [
    { value: 'all', label: 'All projects' },
    ...assignedProjects,
    ...(workspaces?.some(workspace => !workspace.project) ? [noProject] : []),
  ]
  const currentProjectFilter = projectOptions.some(({ value }) => value === projectFilter) ? projectFilter : 'all'
  const query = search.trim().toLowerCase()
  const hasFilters = query !== '' || statusFilter !== 'All' || currentProjectFilter !== 'all'
  const visible = (workspaces ?? []).filter(workspace => {
    const status = statusOf(workspace)
    const projectValue = projectOptionValue(workspace.project)
    return (currentProjectFilter === 'all' || projectValue === currentProjectFilter) &&
      (statusFilter === 'All' || status === statusFilter) &&
      [workspace.name, workspace.project, workspace.description, status, workspace.assignee?.email, ...(workspace.labels ?? [])]
        .some(value => value?.toLowerCase().includes(query))
  })
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))

  const columns: TableColumn<Workspace>[] = [
    { key: 'name', header: 'Workspace', width: proportional(2, { minWidth: 150 }), renderCell: (workspace) =>
      <Link onClick={event => { event.stopPropagation(); setSelectedId(workspace.id) }} weight="semibold">{workspace.name}</Link> },
    { key: 'project', header: 'Project', width: proportional(1, { minWidth: 128 }), renderCell: ({ project }) =>
      <Text>{project || '—'}</Text> },
    { key: 'status', header: 'Status', width: proportional(1, { minWidth: 118 }), renderCell: workspace => {
      const status = statusOf(workspace)
      return <StatusLabel label={status} variant={workspaceVariant[status]} />
    } },
    { key: 'createdAt', header: 'Created', width: proportional(1, { minWidth: 118 }), renderCell: workspace => dateLabel(workspace.createdAt) },
    { key: 'updatedAt', header: 'Updated', width: proportional(1, { minWidth: 118 }), renderCell: workspace => dateLabel(workspace.updatedAt ?? workspace.createdAt) },
    { key: 'assignee', header: 'Assignee', width: proportional(2, { minWidth: 190 }), renderCell: ({ assignee }) =>
      assignee ? <HStack gap={2} vAlign="center"><Avatar size="xsm" name={assignee.email} aria-hidden />
        <Text>{assignee.email}</Text></HStack> : <Text color="secondary">—</Text> },
    { key: 'actions', header: '', width: pixel(56), renderCell: workspace =>
      workspace.role === 'owner' && <HStack onClick={event => event.stopPropagation()}>
        <DropdownMenu
          button={{ label: 'Actions for ' + workspace.name, isIconOnly: true,
            variant: 'ghost', size: 'sm', icon: <Icon icon={EllipsisHorizontalIcon} size="sm" /> }}
          hasChevron={false} alignment="end"
          items={[
            { label: 'Edit', icon: PencilIcon, onClick: () => setAction({ id: workspace.id, kind: 'edit' }) },
            { label: 'Assign to…', icon: UserIcon, onClick: () => setAction({ id: workspace.id, kind: 'assign' }) },
            { label: 'Add label', icon: TagIcon, onClick: () => setAction({ id: workspace.id, kind: 'label' }) },
            { label: 'Duplicate', icon: DocumentDuplicateIcon, onClick: () => setAction({ id: workspace.id, kind: 'duplicate' }) },
            { label: 'Move to project', icon: <Icon icon={ArrowRightIcon} size="sm" xstyle={rtlStyles.mirror} />,
              onClick: () => setAction({ id: workspace.id, kind: 'move' }) },
            { type: 'divider' },
            { label: 'Delete workspace', icon: TrashIcon, variant: 'destructive',
              onClick: () => setAction({ id: workspace.id, kind: 'delete' }) },
          ]}
        />
      </HStack> },
  ]
  const grouped = useTableGroupedRows<Workspace>({
    data: groupBy === 'none' ? [] : visible,
    groupBy: groupBy === 'project' ? workspace => workspace.project || unassignedProject : statusOf,
    groupOrder: groupBy === 'project' ? [...projects, unassignedProject] : [...workspaceStatuses],
    collapsedGroups, getRowKey: workspace => workspace.id,
    onToggleGroup: group => setCollapsedGroups(previous => {
      const next = new Set(previous)
      if (!next.delete(group)) next.add(group)
      return next
    }),
    renderGroupHeader: (key, count) => {
      const status = groupBy === 'status' && workspaceStatuses.find(item => item === key)
      return <HStack gap={2} vAlign="center">
        {status ? <StatusLabel label={status} variant={workspaceVariant[status]} /> : <Text>{key}</Text>}
        <Badge variant="neutral" label={String(count)} />
      </HStack>
    },
  })
  const openDetails: TablePlugin<Workspace> = {
    transformBodyRow(props, workspace) {
      if (!workspace.id) return props
      return { ...props, htmlProps: { ...props.htmlProps, onClick: () => setSelectedId(workspace.id) } }
    },
  }
  const contracts = selected && contractsByWorkspace?.get(selected.id)
  const selectedStatus = selected && statusOf(selected)
  const details = selected && selectedStatus && <VStack gap={4}>
    <HStack gap={2} vAlign="center">
      <StackItem size="fill"><Text type="supporting" color="secondary">Workspace details</Text></StackItem>
      <Button label="Close panel" variant="ghost" size="sm" isIconOnly icon={<Icon icon={X} size="sm" />}
        onClick={() => setSelectedId(undefined)} />
    </HStack>
    <VStack gap={1}>
      <Heading level={2}>{selected.name}</Heading>
      {selected.description && <Text color="secondary">{selected.description}</Text>}
    </VStack>
    <MetadataList label={{ position: 'start' }}>
      <MetadataListItem label="Status"><StatusLabel label={selectedStatus} variant={workspaceVariant[selectedStatus]} /></MetadataListItem>
      <MetadataListItem label="Project">{selected.project || '—'}</MetadataListItem>
      <MetadataListItem label="Created">{dateLabel(selected.createdAt)}</MetadataListItem>
      <MetadataListItem label="Updated">{dateLabel(selected.updatedAt ?? selected.createdAt)}</MetadataListItem>
      <MetadataListItem label="Assignee">{selected.assignee?.email ?? '—'}</MetadataListItem>
      <MetadataListItem label="Role">{workspaceRole(selected)}</MetadataListItem>
      {Boolean(selected.labels?.length) && <MetadataListItem label="Labels">{selected.labels?.join(', ')}</MetadataListItem>}
    </MetadataList>
    <Button label="Open workspace" href={workspaceHref(selected)} variant="primary" />
    <Heading level={3}>Contracts</Heading>
    {contracts?.length ? <VStack gap={3} role="list" aria-label="Workspace contracts">
      {contracts.map(({ id, title, status, role }, index) => <VStack key={id} gap={2} role="listitem">
        {index > 0 && <Divider />}
        <Link href={'/contracts/' + id} weight="semibold">{title}</Link>
        <MetadataList label={{ position: 'top' }}>
          <MetadataListItem label="Status"><StatusLabel label={status} variant={statusVariant[status]} /></MetadataListItem>
          <MetadataListItem label="Role">{contractRole[role]}</MetadataListItem>
        </MetadataList>
      </VStack>)}
    </VStack>
      : <Text color="secondary">{selected.role === 'member' ? 'No contracts shared yet.' : 'No contracts yet.'}</Text>}
  </VStack>

  return <>
    <Layout height="fill"
      header={<LayoutHeader hasDivider padding={4}>
        <VStack gap={4}>
          <HStack gap={3} vAlign="center" wrap="wrap">
            <StackItem size="fill"><Heading level={1}>Workspaces</Heading></StackItem>
            <Button label="New workspace" href="/workspaces/new" variant="primary" size="lg" />
          </HStack>
          {Boolean(workspaces?.length) && <HStack gap={2} vAlign="center" wrap="wrap">
            <StackItem size="fill">
              <TextInput label="Search workspaces" isLabelHidden placeholder="Search workspaces…"
                width="100%" value={search} onChange={value => { setSearch(value); setCollapsedGroups(new Set()) }} />
            </StackItem>
            <Popover placement="below" alignment="end" width={320} label="Workspace view options" content={
              <VStack gap={3}>
                <Selector label="Status filter" value={statusFilter} options={[...statusFilters]} onChange={value => {
                  setStatusFilter(statusFilters.find(status => status === value) ?? 'All')
                  setCollapsedGroups(new Set())
                }} />
                <Selector label="Project filter" value={currentProjectFilter} options={projectOptions} onChange={value => {
                  setProjectFilter(value)
                  setCollapsedGroups(new Set())
                }} />
                <Divider />
                <RadioList label="Group by" value={groupBy} onChange={value => {
                  setGroupBy(value === 'project' || value === 'status' ? value : 'none')
                  setCollapsedGroups(new Set())
                }}>
                  <RadioListItem value="status" label="Status" />
                  <RadioListItem value="project" label="Project" />
                  <RadioListItem value="none" label="None" />
                </RadioList>
              </VStack>
            }>
              <Button label="View Options" variant="secondary" size="md" />
            </Popover>
          </HStack>}
        </VStack>
      </LayoutHeader>}
      content={<LayoutContent padding={0}>
        {narrow && details && <VStack padding={4} role="complementary" aria-label="Workspace details">{details}</VStack>}
        {error && <Banner status="error" title={error} role="alert" />}
        {workspaces === null || contractsByWorkspace === null ? <VStack padding={4}><Text role="status">Loading workspaces…</Text></VStack>
          : visible.length === 0 ? <EmptyState title={hasFilters ? 'No matching workspaces' : 'No workspaces yet'}
            description={hasFilters ? undefined : 'Create a workspace or accept an invitation from another party.'} />
          : <Table data={groupBy !== 'none' ? grouped.data : visible} columns={columns}
            idKey={groupBy !== 'none' ? grouped.idKey : 'id'}
            density="balanced" dividers="rows" hasHover aria-label="Workspaces"
            plugins={groupBy !== 'none' ? { grouped: grouped.plugin, openDetails } : { openDetails }} />}
        {otherContracts.length > 0 && <VStack gap={3} padding={4}>
          <Heading level={2}>Contracts outside your workspaces</Heading>
          <Table data={otherContracts} columns={contractColumns} idKey="id" aria-label="Contracts outside your workspaces" />
        </VStack>}
      </LayoutContent>}
      end={!narrow && details && <>
        <ResizeHandle resizable={panel.props} isReversed isAlwaysVisible={false} label="Resize workspace details" />
        <LayoutPanel hasDivider resizable={panel.props} padding={4} role="complementary" label="Workspace details">{details}</LayoutPanel>
      </>}
    />
    {customizing && action && (action.kind === 'delete'
      ? <DeleteWorkspace key={customizing.id} workspace={customizing} close={() => setAction(undefined)}
        onDeleted={(id) => { if (selectedId === id) setSelectedId(undefined); onWorkspaceDeleted(id) }} />
      : <CustomizeWorkspace key={customizing.id + ':' + action.kind} workspace={customizing} currentStatus={statusOf(customizing)}
        projectAssignments={[noProject, ...assignedProjects]} action={action.kind} close={() => setAction(undefined)} onSaved={onWorkspaceSaved} />)}
  </>
}
