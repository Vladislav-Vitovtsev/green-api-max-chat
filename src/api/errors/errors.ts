export type ApiErrorKind =
  | 'unauthorized'
  | 'notAuthorized'
  | 'rateLimit'
  | 'quota'
  | 'network'
  | 'validation'
  | 'unknown'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status?: number

  constructor(kind: ApiErrorKind, message = '', status?: number) {
    super(message || kind)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
  }
}

export function errorFromResponse(status: number, text: string): ApiError {
  if (status === 401 || status === 403) return new ApiError('unauthorized', text, status)
  if (status === 429 || status === 469) return new ApiError('rateLimit', text, status)
  if (status === 466) return new ApiError('quota', text, status)
  if (status === 400) return new ApiError('validation', text, status)
  if (status >= 500) return new ApiError('network', text, status)
  return new ApiError('unknown', text, status)
}

export function isAbortError(e: unknown): boolean {
  return (e as { name?: unknown } | null)?.name === 'AbortError'
}

export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e
  return new ApiError('unknown', e instanceof Error ? e.message : String(e))
}
