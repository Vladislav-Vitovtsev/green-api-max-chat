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

// Сообщение, отправленное этой вкладкой, но ещё не подтверждённое сервером (или сервером
// отклонённое): local-* id, ещё не переименованный confirmLocal'ом, или статус pending/failed.
// Используется как keep() для reconcileChatWithHistory (actions.ts.reloadHistory) — такое
// сообщение не должно исчезать под свежей историей, пока оно «в полёте». Здесь, а не в
// actions.ts, чтобы тесты reconcileChatWithHistory (messages.test.ts) использовали ту же
// функцию, а не копию её логики — core не может импортировать store (ESLint-граница слоёв),
// а обратное можно.
export function keepInFlight(m: Message): boolean {
  return m.id.startsWith('local-') || m.status === 'pending' || m.status === 'failed'
}

// quoteContent парсит цитату заново на каждый апсерт и всегда возвращает новый
// объект, даже когда содержимое то же самое (повторный приход одного и того же
// цитирующего сообщения). Сравниваем по содержимому, а не по ссылке, иначе
// каждый такой мерж считается изменением (лишний set/persist/ре-рендер).
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
      // Удалённое сообщение перезатирает текст пустой строкой даже при повторной
      // загрузке истории того же чата (openChat дёргает reloadHistory каждый раз).
      // deleted/edited монотонны: повторная загрузка без флага (или с false) не
      // должна воскрешать удалённое сообщение или снимать пометку «ред.».
      const deleted = existing.deleted || m.deleted
      const edited = existing.edited || m.edited
      // Если входящая копия несёт mediaLabel, её text авторитетен даже пустой:
      // это значит «медиа без подписи», а не «текста не прислали». Иначе старый
      // текст-подпись (или текст, записанный ещё до разделения на mediaLabel/text)
      // переживает обновление и дублируется вместе с новой меткой медиа.
      const text = deleted ? '' : m.mediaLabel !== undefined ? m.text : m.text || existing.text
      const mediaLabel = deleted ? undefined : m.mediaLabel ?? existing.mediaLabel
      // Цитата статична (превью сообщения, на которое ответили, не меняется), поэтому
      // просто сохраняем её, если повторная копия (например, обычное сообщение того
      // же id без quotedMessage) её не несёт.
      const incomingQuote = m.quote ?? existing.quote
      const quote = sameQuote(incomingQuote, existing.quote) ? existing.quote : incomingQuote
      // Своё исходящее сообщение сперва получает клиентский timestamp (Date.now() в момент
      // sendMessage), чтобы сразу встать в ленту. Когда та же копия приходит с сервера
      // (эхо в getChatHistory, id стабилен — см. lessons), её timestamp авторитетен для
      // порядка: переставляем сообщение в orderByChat на серверную позицию, иначе разница
      // между клиентскими часами и моментом, когда сервер принял сообщение, может навсегда
      // оставить его не на своём месте относительно входящих. Входящие уже несут серверное
      // время с первого upsert — для них позицию не трогаем. Отредактированное сообщение
      // (edited монотонен — уже true в existing или incoming) тоже не репозиционируем: GREEN-API
      // отдаёт в такой копии timestamp момента ПРАВКИ, а не исходной отправки, и подвинуть
      // сообщение по нему значило бы передвинуть его в ленте на момент правки, а не отправки.
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

// История с сервера авторитетна только в своём временном окне [fromTs, toTs]: всё, что
// раньше осело в этом чате (например, служебный маркер deletedMessage/editedMessage,
// который когда-то ещё не фильтровался mapHistory и сохранился в персисте пустым баблом
// «Сообщение») и попадает в это окно, но не пришло в очередной getChatHistory и не
// защищено keep(), из чата убирается. Сообщения старше окна (< fromTs) не трогаем —
// история могла быть загружена не полностью. Сообщения новее окна (> toTs) тоже не
// трогаем: например, своё уже подтверждённое (sent) сообщение, отправленное только что —
// сервер мог ещё не успеть отдать его в getChatHistory, и без верхней границы оно бы
// удалялось как «не подтверждённое историей» при каждом повторном открытии чата.
// Пустая/неудавшаяся история ничего не стирает.
//
// Контракт keep(): функция решает, какие сообщения нельзя удалять, даже если их
// нет в history и они попадают в окно по времени. Помимо ещё не подтверждённых
// local-/pending/failed (см. keepInFlight выше в этом файле), вызывающая сторона должна
// защищать и сообщения, появившиеся в чате уже ПОСЛЕ того, как был отправлен
// запрос истории (снимок известных на тот момент id, а не текущий стейт на момент
// вызова reconcile) — иначе свежее входящее, пришедшее по опросу, пока
// getChatHistory ещё висел в await, будет удалено как «не подтверждённое историей».
//
// rawMaxTs: максимальный timestamp *сырого* ответа getChatHistory, включая записи
// deletedMessage/editedMessage — эти маркеры mapHistory отфильтровывает (см. history.ts),
// но у них тоже есть timestamp, и обычно он новее всех настоящих сообщений (действие
// произошло позже создания). Если считать toTs только по уже отфильтрованному history,
// граница окна окажется ниже, чем сервер реально подтвердил, — и старый бабл от такого
// маркера, осевший в персисте ещё до того, как mapHistory стал их фильтровать (см. lessons),
// окажется «новее границы» и переживёт reconcile, хотя сервер уже не о нём не знает.
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
