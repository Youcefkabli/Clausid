import { useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import SettingsDialog from './app/settings-dialog/page.tsx'

export function AccountSettings({ account }: { account: { name: string; email: string } }) {
  const [open, setOpen] = useState(false)

  return <>
    <Button label="Account settings" onClick={() => setOpen(true)} />
    {open && <SettingsDialog isOpen={open} onOpenChange={setOpen} account={account} />}
  </>
}
