export const MEDIA_LABELS: Record<string, string> = {
  imageMessage: '[изображение]',
  videoMessage: '[видео]',
  documentMessage: '[файл]',
  audioMessage: '[аудио]',
  stickerMessage: '[стикер]',
  reactionMessage: '[реакция]',
  pollMessage: '[опрос]',
  locationMessage: '[геопозиция]',
  contactMessage: '[контакт]',
}

const FALLBACK = '[сообщение]'

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {})
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

export function extractNotificationText(messageData: unknown): string {
  const md = obj(messageData)
  const type = str(md.typeMessage) ?? ''
  if (type === 'textMessage') return str(obj(md.textMessageData).textMessage) ?? ''
  if (type === 'extendedTextMessage' || type === 'quotedMessage') {
    return str(obj(md.extendedTextMessageData).text) ?? ''
  }
  return MEDIA_LABELS[type] ?? FALLBACK
}

export function historyText(typeMessage: string, textMessage: string | undefined): string {
  if (typeMessage === 'textMessage' || typeMessage === 'extendedTextMessage' || typeMessage === 'quotedMessage') {
    return textMessage ?? ''
  }
  return MEDIA_LABELS[typeMessage] ?? FALLBACK
}
