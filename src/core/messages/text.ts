import type { Message, Quote } from '../model'

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

export type MessageContent = { text: string; mediaLabel?: string }

function mediaContent(type: string, caption: string | undefined): MessageContent {
  return { mediaLabel: MEDIA_LABELS[type] ?? FALLBACK, text: caption?.trim() ?? '' }
}

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {})
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

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

export function captionOf(m: Message): string {
  return m.mediaLabel && m.text === m.mediaLabel ? '' : m.text
}
