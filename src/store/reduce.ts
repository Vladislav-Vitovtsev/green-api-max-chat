import { applyStatus, confirmLocal, nextStatus, upsertMessages } from '../core/messages'
import type { Chat, DomainEvent, Message } from '../core/model'
import type { AppState } from './store'

// sendMessage таймаутится через 30с (см. api/greenApi.ts) и помечает своё сообщение failed,
// хотя сервер вполне мог успеть принять его — просто ответ не успел долететь. Эхо
// (outgoingAPIMessageReceived/outgoingMessageReceived) для такого сообщения приходит уже ПОСЛЕ
// того, как локальная копия ушла в failed (или ещё pending, если таймаут не успел сработать).
// Матчим его с local-* тем же текстом в том же чате за это окно — иначе рядом остаются
// «failed local-» и «sent <реальный id>» одновременно, и «Повторить» создал бы дубликат.
const ECHO_MATCH_WINDOW_MS = 2 * 60 * 1000

function findTimedOutLocalMatch(s: AppState, m: Message): string | undefined {
  // Уже известный id (подтверждён напрямую ответом sendMessage, или это повтор уведомления)
  // не ищет себе local-*-пару: обычный id-based upsert ниже и так его обновит. Без этой
  // проверки повторное/запоздавшее уведомление об уже известном сообщении могло бы увести
  // ДРУГОЙ, ещё не подтверждённый local- с тем же текстом (например, второе «ок», отправленное
  // следом) — их text+время совпадают, но это разные сообщения.
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
      // Повтор уже известного сообщения (дубликат уведомления) без буферизованного статуса
      // и без изменений в чате — upsertMessages/touchChat в этом случае возвращают входной s
      // без изменений. Раскладывать messages как патч тогда нельзя: messages в этой ветке —
      // это буквально весь s (у upsertMessages/applyStatus такой контракт «ничего не
      // поменялось»), и `{...messages}` унёс бы в set() весь AppState как будто это дельта.
      if (messages === s && pendingStatus === s.pendingStatus && chatPatch.chats === s.chats && chatPatch.chatOrder === s.chatOrder) {
        return {}
      }
      return { ...messages, pendingStatus, ...chatPatch }
    }
    case 'status': {
      // Матчим по idMessage независимо от ev.chatId: GREEN-API не всегда присылает его
      // в том же формате, что ключ в s.chats (например, с суффиксом '@c.us') — сообщение
      // при этом наше, просто по chatId его не узнать.
      const applied = applyStatus(s, ev.idMessage, ev.status)
      // applyStatus, когда статус не вырос, возвращает свой входной state как есть — здесь
      // это весь s. Без сравнения с s пришлось бы отдать его целиком как патч (лишний
      // set/persist/ре-рендер на каждый повторный/просевший статус).
      if (applied) return applied === s ? {} : applied
      // Сообщения с этим idMessage ещё нет. Буферизуем статус в pendingStatus только если
      // чат наш — иначе сообщение из него никогда не придёт, и буфер рос бы вхолостую.
      // ev.chatId сверяем с той же нормализацией, что и матчинг по idMessage выше: GREEN-API
      // может прислать его с суффиксом ('10000001@c.us'), а s.chats ключуется без него.
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
