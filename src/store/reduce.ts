import { applyStatus, nextStatus, upsertMessagesWithEcho } from '../core/messages'
import type { Chat, DomainEvent, Message } from '../core/model'
import { formatPhone, plausiblePhone } from '../core/phone'
import type { AppState } from './store'

export function sortChatOrder(chats: Record<string, Chat>, order: string[]): string[] {
  return [...order].sort((a, b) => (chats[b]?.lastMessageAt ?? 0) - (chats[a]?.lastMessageAt ?? 0))
}

export function syncedOrder(chats: Record<string, Chat>, order: string[], getChatsOrder: string[]): string[] {
  const rank = new Map(getChatsOrder.map((id, i) => [id, i]))
  return [...new Set(order)].sort((a, b) => {
    const la = chats[a]?.lastMessageAt
    const lb = chats[b]?.lastMessageAt
    if (la !== undefined || lb !== undefined) return (lb ?? -Infinity) - (la ?? -Infinity)
    return (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity)
  })
}

export function orderEquals(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

export function recomputeLastMessageAt(
  chats: Record<string, Chat>,
  orderByChat: Record<string, string[]>,
  messagesById: Record<string, Message>,
): Record<string, Chat> {
  let out = chats
  for (const [chatId, chat] of Object.entries(chats)) {
    const order = orderByChat[chatId]
    const tail = order && order.length > 0 ? messagesById[order[order.length - 1]!] : undefined
    const lastMessageAt = tail?.timestamp
    if (lastMessageAt === chat.lastMessageAt) continue
    if (out === chats) out = { ...chats }
    out[chatId] = { ...chat, lastMessageAt }
  }
  return out
}

type ReadState = Pick<AppState, 'chats' | 'orderByChat' | 'messagesById'>

export function markRead(s: ReadState, chatId: string | null): Record<string, Chat> {
  const chat = chatId ? s.chats[chatId] : undefined
  if (!chat) return s.chats
  const order = s.orderByChat[chat.chatId] ?? []
  let latest = 0
  for (let i = order.length - 1; i >= 0; i--) {
    const m = s.messagesById[order[i]!]
    if (m?.direction === 'in') {
      latest = m.timestamp
      break
    }
  }
  const readUpTo = Math.max(chat.readUpTo ?? 0, latest)
  if (readUpTo === chat.readUpTo) return s.chats
  return { ...s.chats, [chat.chatId]: { ...chat, readUpTo } }
}

export function unreadOf(s: ReadState & Pick<AppState, 'activeChatId'>, chatId: string): number {
  const chat = s.chats[chatId]
  if (!chat || chatId === s.activeChatId) return 0
  const since = chat.readUpTo ?? chat.serverUnreadAt ?? -Infinity
  const order = s.orderByChat[chatId] ?? []
  let count = 0
  for (let i = order.length - 1; i >= 0; i--) {
    const m = s.messagesById[order[i]!]
    if (!m) continue
    if (m.timestamp <= since) break
    if (m.direction === 'in' && !m.deleted) count++
  }
  return chat.readUpTo === undefined ? (chat.serverUnread ?? 0) + count : count
}

export function touchChat(s: AppState, chatId: string, m: Message, chatName?: string): Pick<AppState, 'chats' | 'chatOrder'> {
  const chat = s.chats[chatId]!
  const isPlaceholderTitle = chat.title.startsWith('+') || chat.title === chat.chatId
  const title = chatName && isPlaceholderTitle ? chatName : chat.title
  const lastMessageAt = Math.max(chat.lastMessageAt ?? 0, m.timestamp)
  if (title === chat.title && lastMessageAt === chat.lastMessageAt) return { chats: s.chats, chatOrder: s.chatOrder }
  const chats = { ...s.chats, [chatId]: { ...chat, title, lastMessageAt } }
  return { chats, chatOrder: sortChatOrder(chats, s.chatOrder) }
}

function createUnknownChat(s: AppState, ev: Extract<DomainEvent, { type: 'message' }>): Pick<AppState, 'chats' | 'chatOrder'> | null {
  if (ev.chatType !== 'user') return null
  const chatId = ev.message.chatId
  const phone = plausiblePhone(ev.peerPhone)
  const chat: Chat = {
    chatId,
    phone,
    title: ev.chatName || (phone ? formatPhone(phone) : chatId),
    historyLoaded: false,
    lastMessageAt: ev.message.timestamp,
  }
  const chats = { ...s.chats, [chatId]: chat }
  return { chats, chatOrder: sortChatOrder(chats, [...s.chatOrder, chatId]) }
}

export function reduceEvent(s: AppState, ev: DomainEvent): Partial<AppState> {
  switch (ev.type) {
    case 'message': {
      const m = ev.message
      let base = s
      let created = false
      if (!s.chats[m.chatId]) {
        const patch = createUnknownChat(s, ev)
        if (!patch) return {}
        base = { ...s, ...patch }
        created = true
      }
      let messages = upsertMessagesWithEcho(base, [m])
      let pendingStatus = base.pendingStatus
      const buffered = base.pendingStatus[m.id]
      if (buffered) {
        messages = applyStatus(messages, m.id, buffered) ?? messages
        const { [m.id]: _done, ...rest } = base.pendingStatus
        pendingStatus = rest
      }
      const chatPatch = touchChat(base, m.chatId, m, ev.chatName)
      const chats = m.chatId === base.activeChatId
        ? markRead({ ...messages, chats: chatPatch.chats }, m.chatId)
        : chatPatch.chats
      if (
        !created && messages === base && pendingStatus === base.pendingStatus &&
        chats === base.chats && chatPatch.chatOrder === base.chatOrder
      ) {
        return {}
      }
      return { ...messages, pendingStatus, chats, chatOrder: chatPatch.chatOrder }
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
