import { applyStatus, nextStatus, upsertMessages } from '../core/messages'
import type { Chat, DomainEvent, Message } from '../core/model'
import type { AppState } from './store'

export function sortChatOrder(chats: Record<string, Chat>, order: string[]): string[] {
  return [...order].sort((a, b) => (chats[b]?.lastMessageAt ?? 0) - (chats[a]?.lastMessageAt ?? 0))
}

export function touchChat(s: AppState, chatId: string, m: Message, chatName?: string): Pick<AppState, 'chats' | 'chatOrder'> {
  const chat = s.chats[chatId]!
  const title = chatName && chat.title.startsWith('+') ? chatName : chat.title
  const lastMessageAt = Math.max(chat.lastMessageAt ?? 0, m.timestamp)
  if (title === chat.title && lastMessageAt === chat.lastMessageAt) return { chats: s.chats, chatOrder: s.chatOrder }
  const chats = { ...s.chats, [chatId]: { ...chat, title, lastMessageAt } }
  return { chats, chatOrder: sortChatOrder(chats, s.chatOrder) }
}

export function reduceEvent(s: AppState, ev: DomainEvent): Partial<AppState> {
  switch (ev.type) {
    case 'message': {
      const m = ev.message
      if (!s.chats[m.chatId]) return {}
      let messages = upsertMessages(s, [m])
      let pendingStatus = s.pendingStatus
      const buffered = s.pendingStatus[m.id]
      if (buffered) {
        messages = applyStatus(messages, m.id, buffered) ?? messages
        const { [m.id]: _done, ...rest } = s.pendingStatus
        pendingStatus = rest
      }
      return { ...messages, pendingStatus, ...touchChat(s, m.chatId, m, ev.chatName) }
    }
    case 'status': {
      const applied = applyStatus(s, ev.idMessage, ev.status)
      if (applied) return applied
      const prev = s.pendingStatus[ev.idMessage]
      return { pendingStatus: { ...s.pendingStatus, [ev.idMessage]: prev ? nextStatus(prev, ev.status) : ev.status } }
    }
    case 'instanceState':
      if (ev.state === 'authorized') return s.banner === 'notAuthorized' ? { banner: null } : {}
      return { banner: 'notAuthorized' }
    case 'quota':
      return { banner: 'quota' }
  }
}
