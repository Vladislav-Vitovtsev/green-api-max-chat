import { anySignal } from '../abort/abort'
import { ApiError, errorFromResponse, isAbortError } from '../errors/errors'
import { maskSecret } from './mask'
import type { Credentials, RawChatSummary, RawHistoryItem, RawNotification } from './types'

export type GreenApi = {
  getStateInstance(signal?: AbortSignal): Promise<string>
  sendMessage(chatId: string, message: string, signal?: AbortSignal): Promise<{ idMessage: string }>
  getChatHistory(chatId: string, count: number, signal?: AbortSignal): Promise<RawHistoryItem[]>
  checkAccount(phone: string, signal?: AbortSignal): Promise<{ exist: boolean; chatId: string }>
  receiveNotification(timeoutSec: number, signal?: AbortSignal): Promise<RawNotification | null>
  deleteNotification(receiptId: number, signal?: AbortSignal): Promise<void>
  getChats(signal?: AbortSignal): Promise<RawChatSummary[]>
  lastIncomingMessages(minutes: number, signal?: AbortSignal): Promise<RawHistoryItem[]>
  lastOutgoingMessages(minutes: number, signal?: AbortSignal): Promise<RawHistoryItem[]>
}

type CallInit = {
  httpMethod?: 'GET' | 'POST' | 'DELETE'
  body?: unknown
  query?: string
  suffix?: string
  signal?: AbortSignal
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms)
  return signal ? anySignal([signal, timeout]) : timeout
}

export function createGreenApi(creds: Credentials, fetchImpl: typeof fetch = (...a) => fetch(...a)): GreenApi {
  const base = `${creds.apiUrl.trim().replace(/\/+$/, '')}/waInstance${creds.idInstance.trim()}`
  const token = creds.apiTokenInstance.trim()

  async function call<T>(method: string, init: CallInit = {}): Promise<T | null> {
    const url = `${base}/${method}/${token}${init.suffix ?? ''}${init.query ?? ''}`
    const hasBody = init.body !== undefined
    let res: Response
    try {
      res = await fetchImpl(url, {
        method: init.httpMethod ?? 'GET',
        headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
        body: hasBody ? JSON.stringify(init.body) : undefined,
        signal: init.signal,
      })
    } catch (e) {
      if (isAbortError(e)) throw e
      const msg = e instanceof Error ? e.message : String(e)
      throw new ApiError('network', maskSecret(msg, token))
    }
    const text = await res.text()
    if (!res.ok) throw errorFromResponse(res.status, maskSecret(text, token))
    if (!text || text === 'null') return null
    try {
      return JSON.parse(text) as T
    } catch {
      throw new ApiError('unknown', 'Некорректный ответ сервера', res.status)
    }
  }

  return {
    async getStateInstance(signal) {
      const r = await call<{ stateInstance: string }>('getStateInstance', { signal })
      return r?.stateInstance ?? 'unknown'
    },

    async sendMessage(chatId, message, signal) {
      const r = await call<{ idMessage: string }>('sendMessage', {
        httpMethod: 'POST',
        body: { chatId, message },
        signal: withTimeout(signal, 30_000),
      })
      if (!r?.idMessage) throw new ApiError('unknown', 'Сервер не вернул idMessage')
      return r
    },

    async getChatHistory(chatId, count, signal) {
      const r = await call<RawHistoryItem[]>('getChatHistory', {
        httpMethod: 'POST',
        body: { chatId, count },
        signal: withTimeout(signal, 30_000),
      })
      return Array.isArray(r) ? r : []
    },

    async checkAccount(phone, signal) {
      const r = await call<{ exist?: boolean; chatId?: string; status?: boolean; reason?: string }>(
        'checkAccount',
        { httpMethod: 'POST', body: { phoneNumber: Number(phone) }, signal },
      )
      if (r && r.status === false) {
        const reason = maskSecret(r.reason ?? '', token)
        if (/limit/i.test(reason)) throw new ApiError('rateLimit', reason)
        if (/not authorized|starting/i.test(reason)) throw new ApiError('notAuthorized', reason)
        throw new ApiError('unknown', reason)
      }
      return { exist: Boolean(r?.exist), chatId: r?.chatId ?? '' }
    },

    async receiveNotification(timeoutSec, signal) {
      return call<RawNotification>('receiveNotification', {
        query: `?receiveTimeout=${timeoutSec}`,
        signal: withTimeout(signal, (timeoutSec + 10) * 1000),
      })
    },

    async deleteNotification(receiptId, signal) {
      await call('deleteNotification', { httpMethod: 'DELETE', suffix: `/${receiptId}`, signal })
    },

    async getChats(signal) {
      const r = await call<RawChatSummary[]>('getChats', { signal: withTimeout(signal, 30_000) })
      return Array.isArray(r) ? r : []
    },

    async lastIncomingMessages(minutes, signal) {
      const r = await call<RawHistoryItem[]>('lastIncomingMessages', {
        query: `?minutes=${minutes}`,
        signal: withTimeout(signal, 30_000),
      })
      return Array.isArray(r) ? r : []
    },

    async lastOutgoingMessages(minutes, signal) {
      const r = await call<RawHistoryItem[]>('lastOutgoingMessages', {
        query: `?minutes=${minutes}`,
        signal: withTimeout(signal, 30_000),
      })
      return Array.isArray(r) ? r : []
    },
  }
}
