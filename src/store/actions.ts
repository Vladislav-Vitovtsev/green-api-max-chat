import { ApiError, isAbortError, toApiError, type ApiErrorKind } from '../api/errors'
import { createGreenApi, type GreenApi } from '../api/greenApi'
import type { Credentials } from '../api/types'
import { mapHistory, maxRawHistoryTimestamp } from '../core/history'
import { MAX_MESSAGE_LENGTH } from '../core/limits'
import {
  applyStatus, confirmLocal, keepInFlight, markFailed, reconcileChatWithHistory, removeMessage, upsertMessages,
} from '../core/messages'
import type { Message } from '../core/model'
import { formatPhone, normalizePhone } from '../core/phone'
import { createPoller } from '../core/poller'
import { acquireActiveTab, type ActiveTab, type LocksLike } from '../core/tabLock'
import { clearCredentials, loadCredentials, saveCredentials } from './credentials'
import { reduceEvent, touchChat } from './reduce'
import { appStore, initialState, type AppState, type AppStore } from './store'

export const HISTORY_COUNT = 100

export type CreateChatResult =
  | { ok: true; chatId: string }
  | { ok: false; error: 'empty' | 'format' | 'country' | 'noAccount' | ApiErrorKind }

export type Actions = ReturnType<typeof createActions>

type Deps = {
  store: AppStore
  makeApi?: (c: Credentials) => GreenApi
  locks?: LocksLike | null
  lockWaitMs?: number
  uuid?: () => string
  now?: () => number
  creds?: {
    load: typeof loadCredentials
    save: typeof saveCredentials
    clear: typeof clearCredentials
  }
}

export function createActions(deps: Deps) {
  const { store } = deps
  const makeApi = deps.makeApi ?? ((c) => createGreenApi(c))
  const uuid = deps.uuid ?? (() => crypto.randomUUID())
  const now = deps.now ?? (() => Date.now())
  const credStore = deps.creds ?? { load: loadCredentials, save: saveCredentials, clear: clearCredentials }

  let api: GreenApi | null = null
  let session: AbortController | null = null
  let wake: () => void = () => {}
  let activeTab: ActiveTab | null = null
  let generation = 0

  const set = (patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) =>
    store.setState(typeof patch === 'function' ? patch(store.getState()) : patch)

  function ensureOwner(idInstance: string): void {
    const s = store.getState()
    if (s.ownerId !== null && s.ownerId !== idInstance) {
      set({ chats: {}, chatOrder: [], messagesById: {}, orderByChat: {}, ownerId: idInstance })
    } else if (s.ownerId !== idInstance) {
      set({ ownerId: idInstance })
    }
  }

  function startPolling() {
    generation++
    session?.abort()
    const controller = new AbortController()
    session = controller
    const client = api!
    const poller = createPoller({
      receive: (signal) => client.receiveNotification(20, signal),
      ack: (id, signal) => client.deleteNotification(id, signal),
      onEvent: (ev) => {
        const patch = reduceEvent(store.getState(), ev)
        if (Object.keys(patch).length > 0) set(patch)
      },
      onStatus: (c) =>
        set((s) => ({
          connection: c,
          banner: c === 'offline' ? 'offline' : s.banner === 'offline' ? null : s.banner,
        })),
      onFatal: (err) => logout(err.kind),
    })
    wake = () => poller.wake()
    set({ connection: 'polling' })
    poller.run(controller.signal).catch((e: unknown) => {
      if (!isAbortError(e)) console.error('[poll]', toApiError(e).kind)
    })
  }

  async function login(creds: Credentials, remember: boolean): Promise<void> {
    const client = makeApi(creds)
    const gen = generation
    const state = await client.getStateInstance()
    if (gen !== generation || store.getState().tab === 'blocked') return
    if (state !== 'authorized') throw new ApiError('notAuthorized', state)
    api = client
    ensureOwner(creds.idInstance)
    credStore.save(creds, remember)
    set({ credentials: creds, authError: null })
    startPolling()
  }

  function restore(): void {
    const saved = credStore.load()
    if (!saved) return
    api = makeApi(saved.creds)
    ensureOwner(saved.creds.idInstance)
    set({ credentials: saved.creds })
    startPolling()
  }

  function stop(): void {
    generation++
    session?.abort()
    session = null
    wake = () => {}
  }

  function logout(reason?: ApiErrorKind): void {
    generation++
    session?.abort()
    session = null
    api = null
    wake = () => {}
    credStore.clear()
    store.persist.clearStorage()
    store.setState({ ...initialState, tab: store.getState().tab, authError: reason ?? null }, true)
  }

  async function reloadHistory(chatId: string): Promise<void> {
    if (!api) return
    const client = api
    const gen = generation
    const signal = session?.signal
    const knownIds = new Set(store.getState().orderByChat[chatId] ?? [])
    try {
      const raw = await client.getChatHistory(chatId, HISTORY_COUNT, signal)
      const items = mapHistory(raw, chatId)
      const rawMaxTs = maxRawHistoryTimestamp(raw)
      if (gen !== generation) return
      set((s) => {
        const keep = (m: Message) => keepInFlight(m) || !knownIds.has(m.id)
        let merged = reconcileChatWithHistory(s, chatId, items, keep, rawMaxTs)
        const chat = s.chats[chatId]
        if (!chat) return {}
        const last = items[items.length - 1]
        const prevOrder = s.orderByChat[chatId] ?? []
        const nextIds = new Set(merged.orderByChat[chatId] ?? prevOrder)
        let pendingStatus = s.pendingStatus
        for (const id of prevOrder) {
          if (!nextIds.has(id) && id in pendingStatus) {
            if (pendingStatus === s.pendingStatus) pendingStatus = { ...s.pendingStatus }
            delete pendingStatus[id]
          }
        }
        for (const item of items) {
          const buffered = pendingStatus[item.id]
          if (!buffered) continue
          merged = applyStatus(merged, item.id, buffered) ?? merged
          if (pendingStatus === s.pendingStatus) pendingStatus = { ...s.pendingStatus }
          delete pendingStatus[item.id]
        }
        const base = { ...s, ...merged, chats: { ...s.chats, [chatId]: { ...chat, historyLoaded: true } } }
        return {
          ...merged,
          ...(last ? touchChat(base, chatId, last) : { chats: base.chats }),
          historyError: { ...s.historyError, [chatId]: false },
          pendingStatus,
        }
      })
    } catch (e) {
      if (gen !== generation || signal?.aborted || isAbortError(e)) return
      console.warn('[history]', toApiError(e).kind)
      set((s) => ({ historyError: { ...s.historyError, [chatId]: true } }))
    }
  }

  async function openChat(chatId: string | null): Promise<void> {
    set({ activeChatId: chatId })
    if (chatId) await reloadHistory(chatId)
  }

  async function createChat(input: string): Promise<CreateChatResult> {
    const r = normalizePhone(input)
    if (!r.ok) return { ok: false, error: r.error }
    const existing = Object.values(store.getState().chats).find((c) => c.phone === r.phone)
    if (existing) {
      await openChat(existing.chatId)
      return { ok: true, chatId: existing.chatId }
    }
    if (!api) return { ok: false, error: 'unauthorized' }
    const client = api
    const gen = generation
    try {
      const res = await client.checkAccount(r.phone)
      if (gen !== generation) return { ok: false, error: 'unauthorized' }
      if (!res.exist || !res.chatId) return { ok: false, error: 'noAccount' }
      set((s) => ({
        chats: {
          ...s.chats,
          [res.chatId]: { chatId: res.chatId, phone: r.phone, title: formatPhone(r.phone), historyLoaded: false, lastMessageAt: now() },
        },
        chatOrder: [res.chatId, ...s.chatOrder.filter((id) => id !== res.chatId)],
      }))
      await openChat(res.chatId)
      return { ok: true, chatId: res.chatId }
    } catch (e) {
      if (gen !== generation) return { ok: false, error: 'unauthorized' }
      return { ok: false, error: toApiError(e).kind }
    }
  }

  async function sendMessage(chatId: string, raw: string): Promise<void> {
    const text = raw.trim()
    if (!text || text.length > MAX_MESSAGE_LENGTH || !api) return
    if (!store.getState().chats[chatId]) return
    const client = api
    const gen = generation
    const localId = `local-${uuid()}`
    const local: Message = { id: localId, chatId, direction: 'out', text, timestamp: now(), status: 'pending' }
    set((s) => ({ ...upsertMessages(s, [local]), ...touchChat(s, chatId, local) }))
    try {
      const { idMessage } = await client.sendMessage(chatId, text)
      if (gen !== generation) return
      set((s) => {
        const buffered = s.pendingStatus[idMessage]
        const { [idMessage]: _used, ...pendingStatus } = s.pendingStatus
        return { ...confirmLocal(s, localId, idMessage, buffered), pendingStatus }
      })
    } catch (e) {
      if (gen !== generation) return
      console.warn('[send]', toApiError(e).kind)
      set((s) => markFailed(s, localId))
    }
  }

  async function retryMessage(id: string): Promise<void> {
    const m = store.getState().messagesById[id]
    if (!m || m.status !== 'failed' || !id.startsWith('local-') || !m.text.trim()) return
    set((s) => removeMessage(s, id))
    await sendMessage(m.chatId, m.text)
  }

  async function activate(): Promise<void> {
    const gen = generation
    store.setState({ ...initialState }, true)
    await store.persist.rehydrate()
    if (gen !== generation) return
    store.setPersistWritable(true)
    set({ tab: 'active' })
    restore()
  }

  function start(): void {
    if (activeTab) {
      if (store.getState().tab === 'active' && !session) restore()
      return
    }
    activeTab = acquireActiveTab({
      locks: deps.locks,
      waitMs: deps.lockWaitMs,
      onActive: () => void activate(),
      onBlocked: () => set({ tab: 'blocked' }),
      onLost: () => {
        store.setPersistWritable(false)
        stop()
        set({ tab: 'blocked' })
      },
    })
  }

  return {
    start,
    takeOver: (): Promise<void> => activeTab?.takeOver() ?? Promise.resolve(),
    login,
    restore,
    logout,
    stop,
    createChat,
    openChat,
    reloadHistory,
    sendMessage,
    retryMessage,
    wake: () => wake(),
  }
}

export const actions = createActions({ store: appStore })
