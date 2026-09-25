import { applyStatus, confirmLocal, nextStatus, upsertMessages } from '../core/messages'
import type { Chat, DomainEvent, Message } from '../core/model'
import type { AppState } from './store'

const ECHO_MATCH_WINDOW_MS = 2 * 60 * 1000

function findTimedOutLocalMatch(s: AppState, m: Message): string | undefined {
  if (m.direction !== 'out' || s.messagesById[m.id]) return undefined
  for (const id of s.orderByChat[m.chatId] ?? []) {
    const cand = s.messagesById[id]
    if (
      cand && id.startsWith('local-') && (cand.status === 'pending' || cand.status === 'failed') &&
      cand.text === m.text && Math.abs(m.timestamp - cand.timestamp) <= ECHO_MATCH_WINDOW_MS
    ) {
      return id
    }
  }
  return undefined
}

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
      const timedOutLocal = findTimedOutLocalMatch(s, m)
      let messages = upsertMessages(s, [m])
      if (timedOutLocal) messages = confirmLocal(messages, timedOutLocal, m.id)
      let pendingStatus = s.pendingStatus
      const buffered = s.pendingStatus[m.id]
      if (buffered) {
        messages = applyStatus(messages, m.id, buffered) ?? messages
        const { [m.id]: _done, ...rest } = s.pendingStatus
        pendingStatus = rest
      }
      const chatPatch = touchChat(s, m.chatId, m, ev.chatName)
      if (messages === s && pendingStatus === s.pendingStatus && chatPatch.chats === s.chats && chatPatch.chatOrder === s.chatOrder) {
        return {}
      }
      return { ...messages, pendingStatus, ...chatPatch }
    }
    case 'status': {
      const applied = applyStatus(s, ev.idMessage, ev.status)
      if (applied) return applied === s ? {} : applied
      if (!s.chats[ev.chatId.split('@')[0]!]) return {}
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
