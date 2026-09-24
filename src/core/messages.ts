import type { Message, MessageStatus } from './model'

export const statusRank: Record<MessageStatus, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: -1,
}

export function nextStatus(current: MessageStatus, incoming: MessageStatus): MessageStatus {
  if (current === 'failed') return 'failed'
  if (incoming === 'failed') return statusRank[current] <= statusRank.sent ? 'failed' : current
  return statusRank[incoming] > statusRank[current] ? incoming : current
}

export type MessagesState = {
  messagesById: Record<string, Message>
  orderByChat: Record<string, string[]>
}

function insertSorted(order: string[], byId: Record<string, Message>, m: Message): string[] {
  let i = order.length
  while (i > 0 && (byId[order[i - 1]!]?.timestamp ?? 0) > m.timestamp) i--
  return [...order.slice(0, i), m.id, ...order.slice(i)]
}

export function upsertMessages(state: MessagesState, msgs: Message[]): MessagesState {
  let byId = state.messagesById
  let orders = state.orderByChat
  for (const m of msgs) {
    const existing = byId[m.id]
    if (existing) {
      const status = existing.direction === 'out' ? nextStatus(existing.status, m.status) : existing.status
      const text = existing.text || m.text
      if (status !== existing.status || text !== existing.text) {
        byId = { ...byId, [m.id]: { ...existing, status, text } }
      }
      continue
    }
    byId = { ...byId, [m.id]: m }
    orders = { ...orders, [m.chatId]: insertSorted(orders[m.chatId] ?? [], byId, m) }
  }
  if (byId === state.messagesById && orders === state.orderByChat) return state
  return { messagesById: byId, orderByChat: orders }
}

export function applyStatus(state: MessagesState, idMessage: string, status: MessageStatus): MessagesState | null {
  const m = state.messagesById[idMessage]
  if (!m) return null
  const next = nextStatus(m.status, status)
  if (next === m.status) return state
  return { ...state, messagesById: { ...state.messagesById, [idMessage]: { ...m, status: next } } }
}

export function removeMessage(state: MessagesState, id: string): MessagesState {
  const m = state.messagesById[id]
  if (!m) return state
  const { [id]: _removed, ...rest } = state.messagesById
  const order = (state.orderByChat[m.chatId] ?? []).filter((x) => x !== id)
  return { messagesById: rest, orderByChat: { ...state.orderByChat, [m.chatId]: order } }
}

export function confirmLocal(
  state: MessagesState,
  localId: string,
  idMessage: string,
  bufferedStatus?: MessageStatus,
): MessagesState {
  const local = state.messagesById[localId]
  if (!local) return state
  const echo = state.messagesById[idMessage]

  if (echo) {
    const without = removeMessage(state, localId)
    let status = nextStatus(echo.status, 'sent')
    if (bufferedStatus) status = nextStatus(status, bufferedStatus)
    return {
      ...without,
      messagesById: { ...without.messagesById, [idMessage]: { ...echo, text: echo.text || local.text, status } },
    }
  }

  let status = nextStatus(local.status, 'sent')
  if (bufferedStatus) status = nextStatus(status, bufferedStatus)
  const { [localId]: _old, ...rest } = state.messagesById
  const order = (state.orderByChat[local.chatId] ?? []).map((x) => (x === localId ? idMessage : x))
  return {
    messagesById: { ...rest, [idMessage]: { ...local, id: idMessage, status } },
    orderByChat: { ...state.orderByChat, [local.chatId]: order },
  }
}

export function markFailed(state: MessagesState, id: string): MessagesState {
  const m = state.messagesById[id]
  if (!m) return state
  const next = nextStatus(m.status, 'failed')
  if (next === m.status) return state
  return { ...state, messagesById: { ...state.messagesById, [id]: { ...m, status: next } } }
}
