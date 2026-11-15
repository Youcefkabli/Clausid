import { useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Cog6ToothIcon } from '@heroicons/react/24/outline'
import SettingsDialog from './app/settings-dialog/page.tsx'

export { SettingsDialog as AccountSettingsDialog }

export function AccountSettings({ account, compact = false }: {
  account: { name: string; email: string }
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)

  return <>
    <Button label="Account settings" onClick={() => setOpen(true)}
      isIconOnly={compact} icon={compact ? <Cog6ToothIcon /> : undefined} />
    {open && <SettingsDialog isOpen={open} onOpenChange={setOpen} account={account} />}
  </>
}
