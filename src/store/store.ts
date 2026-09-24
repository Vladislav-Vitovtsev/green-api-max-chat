import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { createStore } from 'zustand/vanilla'
import type { ApiErrorKind } from '../api/errors'
import type { Credentials } from '../api/types'
import type { MessagesState } from '../core/messages'
import type { Chat, Message, MessageStatus } from '../core/model'

export type Banner = null | 'otherTab' | 'notAuthorized' | 'quota' | 'offline'
export type Connection = 'idle' | 'polling' | 'follower' | 'offline' | 'error'

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
  // Чей это кэш: idInstance инстанса, под которым данные были сохранены.
  // Сверяется при логине/restore — чужие данные (другой idInstance) не показываем.
  ownerId: string | null
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
}

type Persisted = Pick<AppState, 'chats' | 'chatOrder' | 'messagesById' | 'orderByChat' | 'ownerId'>

const memoryStorage = (): StateStorage => {
  const m = new Map<string, string>()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }
}

// Персист переживает перезагрузку страницы, а «зависшие» pending-сообщения — нет:
// раз их статус не подтвердился до выгрузки вкладки, дальше он не подтвердится сам.
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

export function createAppStore(storage?: StateStorage) {
  return createStore<AppState>()(
    persist(() => ({ ...initialState }), {
      name: 'max-chat:data',
      version: 2,
      storage: createJSONStorage(() => storage ?? (typeof localStorage !== 'undefined' ? localStorage : memoryStorage())),
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
          chats: p.chats ?? current.chats,
          chatOrder: p.chatOrder ?? current.chatOrder,
          orderByChat: p.orderByChat ?? current.orderByChat,
          ownerId: p.ownerId ?? current.ownerId,
          messagesById: p.messagesById ? failStalePending(p.messagesById) : current.messagesById,
        }
      },
    }),
  )
}

export type AppStore = ReturnType<typeof createAppStore>
export const appStore = createAppStore()
