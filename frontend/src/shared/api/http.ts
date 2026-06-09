import type { ZodType } from 'zod'

import { HttpError, SchemaValidationError } from './errors'

type FetchJsonOptions = RequestInit & {
  cache?: RequestCache
}

export function normalizeAssetPath(path: string) {
  return path.startsWith('/') ? path : `/${path.replace(/^\/+/, '')}`
}

export async function fetchJson<T>(
  path: string,
  schema: ZodType<T>,
  options: FetchJsonOptions = {},
) {
  const response = await fetch(path, {
    cache: 'no-store',
    ...options,
  })

  if (!response.ok) {
    throw new HttpError(path, response.status, response.statusText)
  }

  const payload: unknown = await response.json()
  const parsed = schema.safeParse(payload)

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const fieldPath = issue.path.length ? issue.path.join('.') : 'root'
      return `${fieldPath}: ${issue.message}`
    })

    throw new SchemaValidationError(path, issues)
  }

  return parsed.data
}
