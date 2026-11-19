import { errorResponseSchema } from '@clausid/contracts'
import type { ResponseSchema } from '@clausid/contracts'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export class ProtocolError extends Error {
  constructor() {
    super('The server returned an invalid response. Your changes have not been confirmed.')
  }
}

export async function parseResponse<T>(response: Response, schema: ResponseSchema<T>): Promise<T> {
  let data: unknown
  try {
    data = response.status === 204 || response.status === 205 ? undefined : await response.json()
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error
    }
    if (response.ok) {
      throw new ProtocolError()
    }
  }
  if (!response.ok) {
    const result = errorResponseSchema.safeParse(data)
    throw new ApiError(response.status, result.success ? result.data.error : 'The request failed. Please try again.')
  }
  const result = schema.safeParse(data)
  if (!result.success) {
    throw new ProtocolError()
  }
  return result.data
}

export async function request<T>(schema: ResponseSchema<T>, path: string, body?: object, signal?: AbortSignal): Promise<T> {
  const options: RequestInit = {
    ...(signal ? { signal } : {}),
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  }
  return parseResponse(await fetch(path, options), schema)
}
