import { z } from 'zod'

import { requiredValue } from '../packages/contracts/src/invariant.ts'
import { expect } from '@playwright/test'

const mailpit = 'http://127.0.0.1:8025'

export async function linkFor(
  email: string,
  kind: 'verify' | 'reset' | 'invite' | 'workspace',
  { exclude, minimumMessages = 1 }: { exclude?: string; minimumMessages?: number } = {},
) {
  const path = {
    verify: '/api/auth/verify-email',
    reset: '/api/auth/reset-password/',
    workspace: '/workspace-invite/',
    invite: '/invite/',
  }[kind]
  let link: string | undefined
  await expect
    .poll(
      async () => {
        const search = new URL('/api/v1/search', mailpit)
        search.searchParams.set('query', 'to:' + email)
        const { messages } = z.object({ messages: z.array(z.object({ ID: z.string() })) }).parse(await (await fetch(search)).json())
        if (!messages || messages.length < minimumMessages) {
          return false
        }
        for (const message of messages) {
          const data = z.object({ Text: z.string() }).parse(await (await fetch(new URL('/api/v1/message/' + message.ID, mailpit))).json())
          link = String(data.Text)
            .match(/https?:\/\/[^\s<>]+/g)
            ?.find((url) => url.includes(path) && url !== exclude)
          if (link) {
            return true
          }
        }
        return false
      },
      { timeout: 15_000 },
    )
    .toBe(true)
  return requiredValue(link)
}
