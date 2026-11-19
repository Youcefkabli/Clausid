import { invitationAckSchema, workspacePartiesSchema } from '@clausid/contracts'
import { useEffect, useState } from 'react'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { Layout, LayoutContent } from '@astryxdesign/core/Layout'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Heading, Text } from '@astryxdesign/core/Text'
import type { Workspace, WorkspaceParties } from '@clausid/contracts'
import { errorMessage, workspaceAction } from './api.ts'

export function WorkspacePartiesDialog({ workspace }: { workspace: Workspace }) {
  const [open, setOpen] = useState(false)
  const [roster, setRoster] = useState<WorkspaceParties>()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }
    const abort = new AbortController()
    void workspaceAction(workspacePartiesSchema, workspace.id, 'parties', undefined, abort.signal)
      .then(setRoster)
      .catch((reason) => {
        if (!abort.signal.aborted) {
          setError(errorMessage(reason))
        }
      })
    return () => abort.abort()
  }, [open, workspace.id])

  async function invite() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await workspaceAction(invitationAckSchema, workspace.id, 'invite', { email })
      setEmail('')
      setNotice('Workspace invitation sent.')
      setRoster(await workspaceAction(workspacePartiesSchema, workspace.id, 'parties'))
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        label={workspace.role === 'member' ? 'Workspace parties' : 'Share workspace'}
        onClick={() => {
          setRoster(undefined)
          setError('')
          setNotice('')
          setOpen(true)
        }}
      />
      <Dialog isOpen={open} onOpenChange={setOpen} purpose="form" padding={0}>
        <Layout
          header={<DialogHeader title="Workspace parties" onOpenChange={setOpen} />}
          content={
            <LayoutContent>
              <div className="flow">
                {roster?.role === 'owner' && (
                  <form
                    className="template-form"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void invite()
                    }}
                  >
                    <TextInput label="Party email" type="email" isRequired {...{ required: true }} value={email} onChange={setEmail} width="100%" />
                    <div>
                      <Button label="Invite party" type="submit" variant="primary" isLoading={busy} />
                    </div>
                  </form>
                )}
                {error && (
                  <div role="alert">
                    <Banner status="error" title={error} />
                  </div>
                )}
                {notice && <Text role="status">{notice}</Text>}
                {roster && (
                  <>
                    <Heading level={3}>Parties</Heading>
                    <ul>
                      {roster.parties.map((party) => (
                        <li key={party.id}>{party.email}</li>
                      ))}
                    </ul>
                    {!!roster.invitations.length && (
                      <>
                        <Heading level={3}>Pending invitations</Heading>
                        <ul>
                          {roster.invitations.map((address) => (
                            <li key={address}>{address}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                )}
              </div>
            </LayoutContent>
          }
        />
      </Dialog>
    </>
  )
}
