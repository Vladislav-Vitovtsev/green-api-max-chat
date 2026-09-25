import type { RawHistoryItem } from '../api/types'
import type { Message } from './model'
import { mapStatus } from './notifications'
import { historyContent, quoteContent } from './text'

export function mapHistory(items: RawHistoryItem[], chatId: string): Message[] {
  const out: Message[] = []
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    if (!it.idMessage || typeof it.timestamp !== 'number') continue
    if (it.typeMessage === 'deletedMessage' || it.typeMessage === 'editedMessage') continue
    const direction = it.type === 'outgoing' ? 'out' : 'in'
    const deleted = it.isDeleted === true
    const content = deleted ? { text: '' } : historyContent(it.typeMessage, it.textMessage, it.caption)
    out.push({
      id: it.idMessage,
      chatId,
      direction,
      text: content.text,
      mediaLabel: content.mediaLabel,
      timestamp: it.timestamp * 1000,
      status: direction === 'out' ? (mapStatus(it.statusMessage) ?? 'sent') : 'sent',
      deleted,
      edited: it.isEdited === true,
      quote: quoteContent(it.quotedMessage, chatId),
    })
  }
  return out.sort((a, b) => a.timestamp - b.timestamp)
}

export function maxRawHistoryTimestamp(items: RawHistoryItem[]): number {
  let max = 0
  for (const it of items) {
    if (!it || typeof it !== 'object' || typeof it.timestamp !== 'number') continue
    const ts = it.timestamp * 1000
    if (ts > max) max = ts
  }
  return max
}
