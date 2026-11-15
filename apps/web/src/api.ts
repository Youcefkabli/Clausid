import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient()
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
export async function api<T>(path: string, body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/contracts' + path, body === undefined
    ? { signal }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(response.status, data?.error || 'The request failed. Please try again.')
  return data as T
}
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'The request failed.'
