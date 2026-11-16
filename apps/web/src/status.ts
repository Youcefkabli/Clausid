import type { BadgeVariant } from '@astryxdesign/core/Badge'
import type { Status } from '@clausid/contracts'

export const statusVariant = {
  Draft: 'neutral',
  'Awaiting signatures': 'warning',
  Signed: 'success',
  Voided: 'error',
} as const satisfies Record<Status, BadgeVariant>
