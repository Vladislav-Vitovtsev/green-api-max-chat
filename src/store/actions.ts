import { ApiError, isAbortError, toApiError, type ApiErrorKind } from '../api/errors'
import { createGreenApi, type GreenApi } from '../api/greenApi'
import type { Credentials, RawHistoryItem } from '../api/types'
import { backoffDelay, sleep as realSleep } from '../core/backoff'
import { mapHistory, maxRawHistoryTimestamp } from '../core/history'
import { MAX_MESSAGE_LENGTH } from '../core/limits'
import {
  applyStatus, confirmLocal, keepInFlight, markFailed, reconcileChatWithHistory, removeMessage, upsertMessages,
  upsertMessagesWithEcho,
} from '../core/messages'
import type { Chat, Message } from '../core/model'
import { formatPhone, normalizePhone, plausiblePhone } from '../core/phone'
import { createPoller } from '../core/poller'
import { acquireActiveTab, type ActiveTab, type LocksLike } from '../core/tabLock'
import { clearCredentials, loadCredentials, saveCredentials } from './credentials'
import { markRead, orderEquals, recomputeLastMessageAt, reduceEvent, sortChatOrder, syncedOrder, touchChat } from './reduce'
import { appStore, initialState, type AppState, type AppStore } from './store'

export const HISTORY_COUNT = 100
export const HISTORY_GAP_MS = 1100
export const HISTORY_MAX_RETRIES = 3
export const PREVIEW_PAUSE_MS = 1100
export const PREVIEW_COUNT = 5
export const PREVIEW_MAX_RETRIES = 3
const JOURNAL_MINUTES = 7 * 24 * 60

function abortError(): DOMException {
  return new DOMException('aborted', 'AbortError')
}

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
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
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
  const sleep = deps.sleep ?? realSleep
  const credStore = deps.creds ?? { load: loadCredentials, save: saveCredentials, clear: clearCredentials }

  let api: GreenApi | null = null
  let session: AbortController | null = null
  let wake: () => void = () => {}
  let activeTab: ActiveTab | null = null
  let generation = 0

  type HistoryWaiter = { high: boolean; go: () => void }
  const historyWaiters: HistoryWaiter[] = []
  let historyBusy = false
  let lastHistoryAt: number | null = null
  let pendingReloads = 0

  function pumpHistory(): void {
    if (historyBusy) return
    const idx = historyWaiters.findIndex((w) => w.high || pendingReloads === 0)
    if (idx < 0) return
    const [next] = historyWaiters.splice(idx, 1)
    historyBusy = true
    next!.go()
  }

  function acquireHistory(high: boolean, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(abortError())
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const i = historyWaiters.indexOf(waiter)
        if (i >= 0) historyWaiters.splice(i, 1)
        reject(abortError())
      }
      const waiter: HistoryWaiter = {
        high,
        go: () => {
          signal.removeEventListener('abort', onAbort)
          resolve()
        },
      }
      signal.addEventListener('abort', onAbort, { once: true })
      historyWaiters.push(waiter)
      pumpHistory()
    })
  }

  async function historyRequest(
    client: GreenApi, chatId: string, count: number, signal: AbortSignal, high: boolean,
  ): Promise<RawHistoryItem[]> {
    await acquireHistory(high, signal)
    try {
      if (lastHistoryAt !== null) {
        const wait = lastHistoryAt + HISTORY_GAP_MS - now()
        if (wait > 0) await sleep(wait, signal)
      }
      if (signal.aborted) throw abortError()
      return await client.getChatHistory(chatId, count, signal)
    } finally {
      lastHistoryAt = now()
      historyBusy = false
      pumpHistory()
    }
  }

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
    void syncChatList()
  }

  function restore(): void {
    const saved = credStore.load()
    if (!saved) return
    api = makeApi(saved.creds)
    ensureOwner(saved.creds.idInstance)
    set({ credentials: saved.creds })
    startPolling()
    void syncChatList()
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
    const signal = session?.signal ?? new AbortController().signal
    const s0 = store.getState()
    const knownIds = new Set(s0.orderByChat[chatId] ?? [])
    const wasActive = s0.activeChatId === chatId
    if (s0.historyError[chatId]) set((s) => ({ historyError: { ...s.historyError, [chatId]: false } }))
    pendingReloads++
    try {
      let raw: RawHistoryItem[]
      for (let attempt = 0; ; ) {
        try {
          raw = await historyRequest(client, chatId, HISTORY_COUNT, signal, true)
          break
        } catch (e) {
          if (gen !== generation || signal.aborted || isAbortError(e)) throw e
          const kind = toApiError(e).kind
          if ((kind !== 'rateLimit' && kind !== 'network') || ++attempt > HISTORY_MAX_RETRIES) throw e
          await sleep(backoffDelay(attempt), signal)
          if (gen !== generation || signal.aborted) return
        }
      }
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
        const touched = last ? touchChat(base, chatId, last) : { chats: base.chats }
        let chats = chatId === s.activeChatId ? markRead({ ...merged, chats: touched.chats }, chatId) : touched.chats
        if (wasActive && chatId !== s.activeChatId) {
          const lastIn = items.findLast((m) => m.direction === 'in')
          const target = chats[chatId]
          if (lastIn && target && lastIn.timestamp > (target.readUpTo ?? 0)) {
            chats = { ...chats, [chatId]: { ...target, readUpTo: lastIn.timestamp } }
          }
        }
        return {
          ...merged,
          ...touched,
          chats,
          historyError: { ...s.historyError, [chatId]: false },
          pendingStatus,
        }
      })
    } catch (e) {
      if (gen !== generation || signal.aborted || isAbortError(e)) return
      console.warn('[history]', toApiError(e).kind)
      set((s) => ({ historyError: { ...s.historyError, [chatId]: true } }))
    } finally {
      pendingReloads--
      pumpHistory()
    }
  }

  async function loadOldPreviews(client: GreenApi, gen: number, signal: AbortSignal): Promise<void> {
    const s0 = store.getState()
    const targets = s0.chatOrder.filter(
      (id) => id !== s0.activeChatId && !s0.chats[id]?.historyLoaded && !(s0.orderByChat[id]?.length),
    )
    let attempt = 0
    for (let i = 0; i < targets.length; ) {
      if (gen !== generation || signal.aborted) return
      const chatId = targets[i]!
      const live = store.getState()
      if (chatId === live.activeChatId || live.chats[chatId]?.historyLoaded || live.orderByChat[chatId]?.length) {
        i++
        continue
      }
      let raw: RawHistoryItem[]
      try {
        raw = await historyRequest(client, chatId, PREVIEW_COUNT, signal, false)
      } catch (e) {
        if (gen !== generation || signal.aborted || isAbortError(e)) return
        const kind = toApiError(e).kind
        if (kind === 'rateLimit' || kind === 'network') {
          if (++attempt > PREVIEW_MAX_RETRIES) return
          await sleep(backoffDelay(attempt), signal)
          continue
        }
        console.warn('[preview]', kind)
        attempt = 0
        i++
        continue
      }
      attempt = 0
      if (gen !== generation || signal.aborted) return
      const last = mapHistory(raw, chatId).at(-1)
      const s = store.getState()
      if (last && s.chats[chatId]) {
        const merged = upsertMessagesWithEcho(s, [last], true)
        const touched = touchChat({ ...s, ...merged }, chatId, last)
        const chats = chatId === s.activeChatId ? markRead({ ...merged, chats: touched.chats }, chatId) : touched.chats
        set({ ...merged, ...touched, chats })
      }
      i++
      if (i < targets.length) await sleep(PREVIEW_PAUSE_MS, signal)
    }
  }

  async function syncChatList(): Promise<void> {
    if (!api) return
    const client = api
    const gen = generation
    const signal = session?.signal
    try {
      const requestedAt = now()
      const rawChats = await client.getChats(signal)
      if (gen !== generation) return
      const userChats = rawChats.filter((c) => c.type === 'user')
      const getChatsOrder = userChats.map((c) => c.chatId)

      const s1 = store.getState()
      let chats = s1.chats
      const newIds: string[] = []
      for (const rc of userChats) {
        const phone = plausiblePhone(rc.phoneNumber)
        const existing = chats[rc.chatId]
        const neverOpened = existing?.readUpTo === undefined
        const serverUnread = neverOpened ? rc.unreadCount : existing?.serverUnread
        const serverUnreadAt = neverOpened ? requestedAt : existing?.serverUnreadAt
        if (existing) {
          const isPlaceholder = existing.title.startsWith('+') || existing.title === existing.chatId
          const title = isPlaceholder && rc.name ? rc.name : existing.title
          const nextPhone = plausiblePhone(existing.phone) || phone
          if (
            nextPhone !== existing.phone || title !== existing.title ||
            serverUnread !== existing.serverUnread || serverUnreadAt !== existing.serverUnreadAt
          ) {
            if (chats === s1.chats) chats = { ...chats }
            chats[rc.chatId] = { ...existing, phone: nextPhone, title, serverUnread, serverUnreadAt }
          }
        } else {
          const chat: Chat = {
            chatId: rc.chatId, phone, title: rc.name || (phone ? formatPhone(phone) : rc.chatId),
            historyLoaded: false, serverUnread, serverUnreadAt,
          }
          if (chats === s1.chats) chats = { ...chats }
          chats[rc.chatId] = chat
          newIds.push(rc.chatId)
        }
      }
      const healed = recomputeLastMessageAt(chats, s1.orderByChat, s1.messagesById)
      if (healed !== chats) chats = healed

      const order = syncedOrder(chats, [...s1.chatOrder, ...newIds], getChatsOrder)
      const orderChanged = !orderEquals(order, s1.chatOrder)
      if (chats !== s1.chats || orderChanged) {
        set({ chats, chatOrder: orderChanged ? order : s1.chatOrder })
      }

      const [incoming, outgoing] = await Promise.all([
        client.lastIncomingMessages(JOURNAL_MINUTES, signal),
        client.lastOutgoingMessages(JOURNAL_MINUTES, signal),
      ])
      if (gen !== generation) return

      const byChat = new Map<string, RawHistoryItem[]>()
      for (const item of [...incoming, ...outgoing]) {
        if (!item || typeof item !== 'object' || !item.chatId) continue
        const chatId = item.chatId.split('@')[0]!
        const list = byChat.get(chatId)
        if (list) list.push(item)
        else byChat.set(chatId, [item])
      }

      const s2 = store.getState()
      let result = s2
      for (const [chatId, items] of byChat) {
        if (!result.chats[chatId]) continue
        const mapped = mapHistory(items, chatId)
        const last = mapped[mapped.length - 1]
        if (!last) continue
        const merged = upsertMessagesWithEcho(result, mapped, true)
        const touched = touchChat({ ...result, ...merged }, chatId, last)
        if (
          merged.messagesById !== result.messagesById || merged.orderByChat !== result.orderByChat ||
          touched.chats !== result.chats || touched.chatOrder !== result.chatOrder
        ) {
          result = { ...result, ...merged, ...touched }
        }
      }

      const readChats = markRead(result, result.activeChatId)
      if (readChats !== result.chats) result = { ...result, chats: readChats }

      if (result !== s2) {
        const finalOrder = syncedOrder(result.chats, result.chatOrder, getChatsOrder)
        set({
          messagesById: result.messagesById, orderByChat: result.orderByChat,
          chats: result.chats, chatOrder: orderEquals(finalOrder, result.chatOrder) ? result.chatOrder : finalOrder,
        })
      }

      if (signal) {
        void loadOldPreviews(client, gen, signal).catch((e: unknown) => {
          if (!isAbortError(e)) console.error('[preview]', toApiError(e).kind)
        })
      }
    } catch (e) {
      if (gen !== generation || signal?.aborted || isAbortError(e)) return
      console.error('[syncChatList]', toApiError(e).kind)
    }
  }

  async function openChat(chatId: string | null): Promise<void> {
    set((s) => ({ activeChatId: chatId, chats: markRead({ ...s, chats: markRead(s, s.activeChatId) }, chatId) }))
    if (chatId) await reloadHistory(chatId)
  }

  async function createChat(input: string): Promise<CreateChatResult> {
    const r = normalizePhone(input)
    if (!r.ok) return { ok: false, error: r.error }
    const existing = Object.values(store.getState().chats).find((c) => c.phone !== '' && c.phone === r.phone)
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
      set((s) => {
        const known = s.chats[res.chatId]
        const chat = known
          ? { ...known, phone: known.phone || r.phone }
          : { chatId: res.chatId, phone: r.phone, title: formatPhone(r.phone), historyLoaded: false }
        const chats = { ...s.chats, [res.chatId]: chat }
        return {
          chats,
          chatOrder: known ? s.chatOrder : sortChatOrder(chats, [...s.chatOrder, res.chatId]),
        }
      })
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
    syncChatList,
    sendMessage,
    retryMessage,
    wake: () => wake(),
  }
}

export const actions = createActions({ store: appStore })
