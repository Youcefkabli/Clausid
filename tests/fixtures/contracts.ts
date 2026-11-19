// Producer-shaped public fixtures mirror Contract.#view and workspace sharing, including legacy omissions.
import type { ContractView } from '../../packages/contracts/src/index.ts'

export const accountFixture = { id: 'opaque-account-id', email: 'provider@example.test' }
export function contractFixture(): ContractView {
  return {
    id: '7ad966f6-d9d8-4cd0-979d-8469e5ecb676',
    title: 'Services',
    status: 'Draft',
    role: 'owner',
    revision: 0,
    owner: accountFixture,
    editors: [accountFixture],
    invites: [],
    version: null,
  }
}
export const workspaceFixture = {
  id: '30dd8b90-3e5b-4bc8-a402-20e4d8b7737f',
  name: 'Services',
  description: '',
  project: null,
  firstContractId: null,
}
export const digestFixture = 'a'.repeat(64)
