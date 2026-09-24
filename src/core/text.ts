import type { Message, Quote } from './model'

export const MEDIA_LABELS: Record<string, string> = {
  imageMessage: '📷 Фото',
  videoMessage: '🎥 Видео',
  documentMessage: '📎 Файл',
  audioMessage: '🎤 Аудио',
  stickerMessage: 'Стикер',
  reactionMessage: 'Реакция',
  pollMessage: '📊 Опрос',
  locationMessage: '📍 Геопозиция',
  contactMessage: '👤 Контакт',
}

const FALLBACK = 'Сообщение'

// Медиа-сообщение — это метка типа («📷 Фото») и, отдельно, подпись автора.
// UI кладёт их на разные строки (метка сверху, подпись — как обычный текст
// сообщения снизу), поэтому домен возвращает их раздельно, а не склеенной строкой.
export type MessageContent = { text: string; mediaLabel?: string }

function mediaContent(type: string, caption: string | undefined): MessageContent {
  return { mediaLabel: MEDIA_LABELS[type] ?? FALLBACK, text: caption?.trim() ?? '' }
}

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {})
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

// Подпись к медиа приходит в объекте `<тип>MessageData` (fileMessageData,
// imageMessageData и т. п.) — имя ключа зависит от типа сообщения, поэтому ищем
// защитно: любой объект под messageData, чей ключ оканчивается на MessageData
// и у которого есть строковое поле caption.
function findCaption(md: Obj): string | undefined {
  for (const key of Object.keys(md)) {
    if (!key.endsWith('MessageData')) continue
    const caption = obj(md[key]).caption
    if (typeof caption === 'string') return caption
  }
  return undefined
}

export function extractNotificationContent(messageData: unknown): MessageContent {
  const md = obj(messageData)
  const type = str(md.typeMessage) ?? ''
  if (type === 'textMessage') return { text: str(obj(md.textMessageData).textMessage) ?? '' }
  if (type === 'extendedTextMessage' || type === 'quotedMessage') {
    return { text: str(obj(md.extendedTextMessageData).text) ?? '' }
  }
  return mediaContent(type, findCaption(md))
}

export function historyContent(typeMessage: string, textMessage: string | undefined, caption?: string): MessageContent {
  if (typeMessage === 'textMessage' || typeMessage === 'extendedTextMessage' || typeMessage === 'quotedMessage') {
    return { text: textMessage ?? '' }
  }
  return mediaContent(typeMessage, caption)
}

// Цитата (превью сообщения, на которое отвечают) приходит и в истории
// (item.quotedMessage), и в вебхуках (messageData.quotedMessage или, для
// extendedTextMessage, messageData.extendedTextMessageData.quotedMessage) —
// в обоих случаях сырой объект неизвестной формы, поэтому парсим защитно.
// participant — id автора цитируемого сообщения; в личном чате id собеседника
// совпадает с chatId, поэтому «моё» — это просто несовпадение с ним.
export function quoteContent(raw: unknown, chatId: string): Quote | undefined {
  const q = obj(raw)
  const id = str(q.stanzaId)
  if (!id) return undefined
  const participant = str(q.participant)
  const type = str(q.typeMessage) ?? ''
  const isText = type === 'textMessage' || type === 'extendedTextMessage' || type === 'quotedMessage'
  const text = isText ? (str(q.textMessage) ?? '') : (str(q.caption)?.trim() ?? '')
  const mediaLabel = isText ? undefined : (MEDIA_LABELS[type] ?? FALLBACK)
  return { id, text, mediaLabel, fromMe: participant !== chatId }
}

// Защитно: если text совпадает с mediaLabel (устаревшие данные до разделения на
// метку и подпись, или их слияние не подчистило дубликат), подписи нет — иначе
// одна и та же строка показывается дважды: меткой сверху и текстом снизу.
export function captionOf(m: Message): string {
  return m.mediaLabel && m.text === m.mediaLabel ? '' : m.text
}
