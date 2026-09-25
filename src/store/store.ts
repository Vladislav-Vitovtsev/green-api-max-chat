import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { createStore } from 'zustand/vanilla'
import type { ApiErrorKind } from '../api/errors'
import type { Credentials } from '../api/types'
import type { MessagesState } from '../core/messages'
import type { Chat, Message, MessageStatus } from '../core/model'
import { plausiblePhone } from '../core/phone'

export type Banner = null | 'notAuthorized' | 'quota' | 'offline'
export type Connection = 'idle' | 'polling' | 'offline' | 'error'
export type TabState = 'pending' | 'active' | 'blocked'

export type AppState = MessagesState & {
  credentials: Credentials | null
  chats: Record<string, Chat>
  chatOrder: string[]
  pendingStatus: Record<string, MessageStatus>
  activeChatId: string | null
  connection: Connection
  banner: Banner
  authError: ApiErrorKind | null
  historyError: Record<string, boolean>
  ownerId: string | null
  tab: TabState
}

export const initialState: AppState = {
  credentials: null,
  chats: {},
  chatOrder: [],
  messagesById: {},
  orderByChat: {},
  pendingStatus: {},
  activeChatId: null,
  connection: 'idle',
  banner: null,
  authError: null,
  historyError: {},
  ownerId: null,
  tab: 'pending',
}

type Persisted = Pick<AppState, 'chats' | 'chatOrder' | 'messagesById' | 'orderByChat' | 'ownerId'>

const memoryStorage = (): StateStorage => {
  const m = new Map<string, string>()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }
}

function failStalePending(messagesById: Record<string, Message>): Record<string, Message> {
  let changed = false
  const out: Record<string, Message> = {}
  for (const [id, m] of Object.entries(messagesById)) {
    if (m.status === 'pending') {
      changed = true
      out[id] = { ...m, status: 'failed' }
    } else {
      out[id] = m
    }
  }
  return changed ? out : messagesById
}

function healPersistedChats(chats: Record<string, Chat>): Record<string, Chat> {
  const out: Record<string, Chat> = {}
  for (const [id, chat] of Object.entries(chats)) {
    const { unread: _legacy, ...rest } = chat as Chat & { unread?: number }
    out[id] = { ...rest, phone: plausiblePhone(rest.phone) }
  }
  return out
}

export function createAppStore(storage?: StateStorage) {
  let writable = false
  let resolved: StateStorage | null = null
  const base = () => (resolved ??= storage ?? (typeof localStorage !== 'undefined' ? localStorage : memoryStorage()))
  const guarded: StateStorage = {
    getItem: (k) => base().getItem(k),
    setItem: (k, v) => (writable ? base().setItem(k, v) : undefined),
    removeItem: (k) => (writable ? base().removeItem(k) : undefined),
  }
  const store = createStore<AppState>()(
    persist(() => ({ ...initialState }), {
      name: 'max-chat:data',
      version: 2,
      storage: createJSONStorage(() => guarded),
      partialize: (s): Persisted => ({
        chats: s.chats,
        chatOrder: s.chatOrder,
        messagesById: s.messagesById,
        orderByChat: s.orderByChat,
        ownerId: s.ownerId,
      }),
      migrate: (persisted, version) => (version === 2 ? (persisted as Persisted) : ({} as Persisted)),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Persisted>
        return {
          ...current,
          chats: p.chats ? healPersistedChats(p.chats) : current.chats,
          chatOrder: p.chatOrder ?? current.chatOrder,
          orderByChat: p.orderByChat ?? current.orderByChat,
          ownerId: p.ownerId ?? current.ownerId,
          messagesById: p.messagesById ? failStalePending(p.messagesById) : current.messagesById,
        }
      },
    }),
  )
  return Object.assign(store, {
    setPersistWritable: (v: boolean) => void (writable = v),
  })
}

export type AppStore = ReturnType<typeof createAppStore>
export const appStore = createAppStore()
