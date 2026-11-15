import type { BadgeVariant } from '@astryxdesign/core/Badge'
import type { Status } from '@clausid/contracts'

export const statusVariant: Record<Status, BadgeVariant> = {
  Draft: 'neutral',
  'Awaiting signatures': 'warning',
  Signed: 'success',
  Voided: 'error',
}
