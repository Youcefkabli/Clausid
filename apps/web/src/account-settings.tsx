import { useState } from 'react'
import { Avatar } from '@astryxdesign/core/Avatar'
import SettingsDialog from './app/settings-dialog/page.tsx'

export { SettingsDialog as AccountSettingsDialog }

export function AccountSettings({ account }: {
  account: { name: string; email: string }
}) {
  const [open, setOpen] = useState(false)

  return <>
    <Avatar size="sm" name={account.name} alt="Account settings" tooltip="Account settings"
      onClick={() => setOpen(true)} />
    {open && <SettingsDialog isOpen={open} onOpenChange={setOpen} account={account} />}
  </>
}
