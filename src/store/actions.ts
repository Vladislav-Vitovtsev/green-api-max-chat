import { ApiError, isAbortError, toApiError, type ApiErrorKind } from '../api/errors'
import { createGreenApi, type GreenApi } from '../api/greenApi'
import type { Credentials } from '../api/types'
import { mapHistory } from '../core/history'
import { runAsLeader, type LocksLike } from '../core/leader'
import { confirmLocal, markFailed, removeMessage, upsertMessages } from '../core/messages'
import type { Message } from '../core/model'
import { formatPhone, normalizePhone } from '../core/phone'
import { createPoller } from '../core/poller'
import { clearCredentials, loadCredentials, saveCredentials } from './credentials'
import { reduceEvent, touchChat } from './reduce'
import { appStore, initialState, type AppState, type AppStore } from './store'

export const MAX_MESSAGE_LENGTH = 4000
export const HISTORY_COUNT = 100

export type CreateChatResult =
  | { ok: true; chatId: string }
  | { ok: false; error: 'empty' | 'format' | 'country' | 'noAccount' | ApiErrorKind }

export type Actions = ReturnType<typeof createActions>

type Deps = {
  store: AppStore
  makeApi?: (c: Credentials) => GreenApi
  locks?: LocksLike | null
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
  // R17: сессии опроса не должны пересекаться — новый runAsLeader стартует только
  // после того, как устоится (settle) предыдущий, иначе вкладка на миг сама себе
  // становится follower'ом (вспышка баннера otherTab) при релогине/HMR.
  let leaderRun: Promise<void> = Promise.resolve()
  // Поколение сессии: растёт на каждый старт/останов опроса. Асинхронные операции
  // (createChat/reloadHistory/sendMessage) захватывают его перед await и после
  // await молча ничего не делают, если оно уже сменилось (logout/stop/релогин).
  let generation = 0

  const set = (patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) =>
    store.setState(typeof patch === 'function' ? patch(store.getState()) : patch)

  // Персист может принадлежать другому инстансу (другая вкладка, другой аккаунт
  // на этом же компьютере) — сверяем ownerId и, если он не совпадает, сбрасываем
  // унаследованные чаты/сообщения, прежде чем начинать текущую сессию.
  function ensureOwner(idInstance: string): void {
    const s = store.getState()
    if (s.ownerId !== null && s.ownerId !== idInstance) {
      set({ chats: {}, chatOrder: [], messagesById: {}, orderByChat: {}, ownerId: idInstance })
    } else if (s.ownerId !== idInstance) {
      set({ ownerId: idInstance })
    }
  }

  function startPolling(creds: Credentials) {
    generation++
    session?.abort()
    const controller = new AbortController()
    session = controller
    const client = api!
    const poller = createPoller({
      receive: (signal) => client.receiveNotification(20, signal),
      ack: (id, signal) => client.deleteNotification(id, signal),
      onEvent: (ev) => set((s) => reduceEvent(s, ev)),
      onStatus: (c) =>
        set((s) => ({
          connection: c,
          banner: c === 'offline' ? 'offline' : s.banner === 'offline' || s.banner === 'otherTab' ? null : s.banner,
        })),
      onFatal: (err) => logout(err.kind),
    })
    wake = () => poller.wake()
    const prev = leaderRun
    leaderRun = prev.then(() =>
      runAsLeader(`greenapi-poll-${creds.idInstance}`, {
        signal: controller.signal,
        locks: deps.locks,
        onFollower: () => set({ connection: 'follower', banner: 'otherTab' }),
        onLeader: async (signal) => {
          if (signal.aborted) return
          set((s) => ({ connection: 'polling', banner: s.banner === 'otherTab' ? null : s.banner }))
          await poller.run(signal)
        },
      }).catch((e: unknown) => console.error('[poll]', toApiError(e).kind)),
    )
  }

  async function login(creds: Credentials, remember: boolean): Promise<void> {
    const client = makeApi(creds)
    const state = await client.getStateInstance()
    if (state !== 'authorized') throw new ApiError('notAuthorized', state)
    api = client
    ensureOwner(creds.idInstance)
    credStore.save(creds, remember)
    set({ credentials: creds, authError: null })
    startPolling(creds)
  }

  function restore(): void {
    const saved = credStore.load()
    if (!saved) return
    api = makeApi(saved.creds)
    ensureOwner(saved.creds.idInstance)
    set({ credentials: saved.creds })
    startPolling(saved.creds)
    const active = store.getState().activeChatId
    if (active) void reloadHistory(active)
  }

  // R6: обрывает текущую сессию опроса, не трогая креды и данные — используется
  // из HMR dispose в App.tsx вместо logout(), чтобы при hot-reload не терять стейт.
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
    const persisted = store as AppStore & { persist?: { clearStorage(): void } }
    persisted.persist?.clearStorage()
    store.setState({ ...initialState, authError: reason ?? null }, true)
  }

  async function reloadHistory(chatId: string): Promise<void> {
    if (!api) return
    const client = api
    const gen = generation
    const signal = session?.signal
    try {
      const items = mapHistory(await client.getChatHistory(chatId, HISTORY_COUNT, signal))
      if (gen !== generation) return
      set((s) => {
        const merged = upsertMessages(s, items)
        const chat = s.chats[chatId]
        if (!chat) return {}
        const last = items[items.length - 1]
        const base = { ...s, ...merged, chats: { ...s.chats, [chatId]: { ...chat, historyLoaded: true } } }
        return {
          ...merged,
          ...(last ? touchChat(base, chatId, last) : { chats: base.chats }),
          historyError: { ...s.historyError, [chatId]: false },
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
    if (!m || m.status !== 'failed') return
    set((s) => removeMessage(s, id))
    await sendMessage(m.chatId, m.text)
  }

  return {
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
