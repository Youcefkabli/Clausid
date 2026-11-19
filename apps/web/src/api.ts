import { createAuthClient } from 'better-auth/react'
import type { ResponseSchema } from '@clausid/contracts'
import { request } from './response.ts'
export { ApiError, ProtocolError } from './response.ts'

export const authClient = createAuthClient()
export const api = <T>(schema: ResponseSchema<T>, path: string, body?: object, signal?: AbortSignal) => request(schema, '/api/contracts' + path, body, signal)
export const workspaceApi = <T>(schema: ResponseSchema<T>, body?: object, signal?: AbortSignal) => request(schema, '/api/workspaces', body, signal)
export const workspaceAction = <T>(schema: ResponseSchema<T>, id: string, action: string, body?: object, signal?: AbortSignal) =>
  request(schema, '/api/workspaces/' + id + '/' + action, body, signal)
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : 'The request failed.')
