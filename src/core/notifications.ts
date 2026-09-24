import type { DomainEvent, MessageStatus } from './model'
import { extractNotificationText } from './text'

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {})
const nonEmptyStr = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

export function mapStatus(raw: unknown): MessageStatus | null {
  switch (raw) {
    case 'sent':
    case 'delivered':
    case 'read':
      return raw
    case 'failed':
    case 'noAccount':
    case 'notInGroup':
    case 'suspended':
      return 'failed'
    default:
      return null
  }
}

const MESSAGE_TYPES: Record<string, 'in' | 'out'> = {
  incomingMessageReceived: 'in',
  outgoingMessageReceived: 'out',
  outgoingAPIMessageReceived: 'out',
}

export function parseNotification(body: unknown): DomainEvent | null {
  const b = obj(body)
  const type = nonEmptyStr(b.typeWebhook)
  if (!type) return null

  const direction = MESSAGE_TYPES[type]
  if (direction) {
    const sender = obj(b.senderData)
    const chatId = nonEmptyStr(sender.chatId)
    const id = nonEmptyStr(b.idMessage)
    const ts = num(b.timestamp)
    if (!chatId || !id || ts === undefined) return null
    return {
      type: 'message',
      chatName: nonEmptyStr(sender.chatName) ?? nonEmptyStr(sender.senderName),
      message: {
        id,
        chatId,
        direction,
        text: extractNotificationText(b.messageData),
        timestamp: ts * 1000,
        status: 'sent',
      },
    }
  }

  if (type === 'outgoingMessageStatus') {
    const chatId = nonEmptyStr(b.chatId)
    const idMessage = nonEmptyStr(b.idMessage)
    const status = mapStatus(b.status)
    if (!chatId || !idMessage || !status) return null
    return { type: 'status', chatId, idMessage, status }
  }

  if (type === 'stateInstanceChanged') {
    const state = nonEmptyStr(b.stateInstance)
    return state ? { type: 'instanceState', state } : null
  }

  if (type === 'quotaExceeded') return { type: 'quota' }
  return null
}
