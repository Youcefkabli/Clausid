// Parse the real private invitation relay before mail dispatch; preserve valid URL/role behavior and reject malformed JSON shapes.
import { expect, it } from 'vite-plus/test'
import { sendInvitation } from '../apps/auth/src/operations.ts'

it('preserves workspace and signer links through the private relay parser', async () => {
  const messages: { to: string; subject: string; text: string }[] = []
  const send = async (to: string, subject: string, text: string) => {
    messages.push({ to, subject, text })
  }
  await sendInvitation('https://example.test', send, { email: 'party@example.test', contractId: 'workspace-id', token: 'fixture token', role: 'workspace' })
  await sendInvitation('https://example.test', send, { email: 'party@example.test', contractId: 'contract-id', token: 'fixture token', role: 'signer' })
  expect(messages).toMatchObject([
    {
      to: 'party@example.test',
      subject: 'You are invited to a Clausid workspace',
    },
    {
      to: 'party@example.test',
      subject: 'You have a Clausid contract to sign',
    },
  ])
  expect(messages).toHaveLength(2)
  expect(messages[0]?.text).toContain('https://example.test/workspace-invite/workspace-id#token=fixture+token')
  expect(messages[1]?.text).toContain('https://example.test/invite/contract-id#token=fixture+token')
})

it('rejects malformed relay input before sending any mail', async () => {
  let sent = 0
  for (const value of [
    null,
    [],
    {},
    { email: 7, contractId: 'id', token: 'token', role: 'editor' },
    { email: 'party@example.test', contractId: 'id', role: 'editor' },
  ]) {
    await expect(
      sendInvitation(
        'https://example.test',
        async () => {
          sent++
        },
        value,
      ),
    ).rejects.toThrow()
  }
  expect(sent).toBe(0)
})
