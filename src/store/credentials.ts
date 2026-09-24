import type { Credentials } from '../api/types'

const KEY = 'max-chat:credentials'

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

function parse(raw: string | null): Credentials | null {
  if (!raw) return null
  const v = safe(() => JSON.parse(raw) as Partial<Credentials>, null)
  if (!v || typeof v.apiUrl !== 'string' || typeof v.idInstance !== 'string' || typeof v.apiTokenInstance !== 'string') {
    return null
  }
  return { apiUrl: v.apiUrl, idInstance: v.idInstance, apiTokenInstance: v.apiTokenInstance }
}

export function loadCredentials(): { creds: Credentials; remember: boolean } | null {
  const session = parse(safe(() => sessionStorage.getItem(KEY), null))
  if (session) return { creds: session, remember: false }
  const local = parse(safe(() => localStorage.getItem(KEY), null))
  return local ? { creds: local, remember: true } : null
}

export function saveCredentials(c: Credentials, remember: boolean): void {
  clearCredentials()
  safe(() => {
    const target = remember ? localStorage : sessionStorage
    target.setItem(KEY, JSON.stringify(c))
  }, undefined)
}

export function clearCredentials(): void {
  safe(() => sessionStorage.removeItem(KEY), undefined)
  safe(() => localStorage.removeItem(KEY), undefined)
}
