import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient()
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
async function request<T>(path: string, body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, body === undefined
    ? { signal }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(response.status, data?.error || 'The request failed. Please try again.')
  return data as T
}
export const api = <T>(path: string, body?: object, signal?: AbortSignal) =>
  request<T>('/api/contracts' + path, body, signal)
export const workspaceApi = <T>(body?: object, signal?: AbortSignal) =>
  request<T>('/api/workspaces', body, signal)
export const workspaceAction = <T>(id: string, action: string, body?: object, signal?: AbortSignal) =>
  request<T>('/api/workspaces/' + id + '/' + action, body, signal)
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'The request failed.'
