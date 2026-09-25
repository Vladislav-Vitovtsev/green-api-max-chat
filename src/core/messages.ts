import type { Message, MessageStatus, Quote } from './model'

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

export function keepInFlight(m: Message): boolean {
  return m.id.startsWith('local-') || m.status === 'pending' || m.status === 'failed'
}

function sameQuote(a: Quote | undefined, b: Quote | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.id === b.id && a.text === b.text && a.mediaLabel === b.mediaLabel && a.fromMe === b.fromMe
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
      const deleted = existing.deleted || m.deleted
      const edited = existing.edited || m.edited
      const text = deleted ? '' : m.mediaLabel !== undefined ? m.text : m.text || existing.text
      const mediaLabel = deleted ? undefined : m.mediaLabel ?? existing.mediaLabel
      const incomingQuote = m.quote ?? existing.quote
      const quote = sameQuote(incomingQuote, existing.quote) ? existing.quote : incomingQuote
      const timestamp = existing.direction === 'out' && !edited ? m.timestamp : existing.timestamp
      if (
        status !== existing.status || text !== existing.text || mediaLabel !== existing.mediaLabel ||
        deleted !== existing.deleted || edited !== existing.edited || quote !== existing.quote ||
        timestamp !== existing.timestamp
      ) {
        const updated = { ...existing, status, text, mediaLabel, deleted, edited, quote, timestamp }
        byId = { ...byId, [m.id]: updated }
        if (timestamp !== existing.timestamp) {
          const order = (orders[m.chatId] ?? []).filter((id) => id !== m.id)
          orders = { ...orders, [m.chatId]: insertSorted(order, byId, updated) }
        }
      }
      continue
    }
    byId = { ...byId, [m.id]: m }
    orders = { ...orders, [m.chatId]: insertSorted(orders[m.chatId] ?? [], byId, m) }
  }
  if (byId === state.messagesById && orders === state.orderByChat) return state
  return { messagesById: byId, orderByChat: orders }
}

export function reconcileChatWithHistory(
  state: MessagesState,
  chatId: string,
  history: Message[],
  keep: (m: Message) => boolean,
  rawMaxTs?: number,
): MessagesState {
  if (history.length === 0) return state

  let fromTs = history[0]!.timestamp
  let toTs = history[0]!.timestamp
  for (const m of history) {
    if (m.timestamp < fromTs) fromTs = m.timestamp
    if (m.timestamp > toTs) toTs = m.timestamp
  }
  if (rawMaxTs !== undefined && rawMaxTs > toTs) toTs = rawMaxTs
  const historyIds = new Set(history.map((m) => m.id))

  const order = state.orderByChat[chatId] ?? []
  let byId = state.messagesById
  let changed = false
  const nextOrder: string[] = []
  for (const id of order) {
    const m = byId[id]
    const stale = m !== undefined && m.timestamp >= fromTs && m.timestamp <= toTs && !historyIds.has(id) && !keep(m)
    if (stale) {
      changed = true
      if (byId === state.messagesById) byId = { ...state.messagesById }
      delete byId[id]
      continue
    }
    nextOrder.push(id)
  }

  const reconciled: MessagesState = changed
    ? { messagesById: byId, orderByChat: { ...state.orderByChat, [chatId]: nextOrder } }
    : state

  return upsertMessages(reconciled, history)
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
