import type { RawHistoryItem } from '../api/types'
import type { Message } from './model'
import { mapStatus } from './notifications'
import { historyText } from './text'

export function mapHistory(items: RawHistoryItem[]): Message[] {
  const out: Message[] = []
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    if (!it.idMessage || !it.chatId || typeof it.timestamp !== 'number') continue
    const direction = it.type === 'outgoing' ? 'out' : 'in'
    out.push({
      id: it.idMessage,
      chatId: it.chatId,
      direction,
      text: historyText(it.typeMessage, it.textMessage),
      timestamp: it.timestamp * 1000,
      status: direction === 'out' ? (mapStatus(it.statusMessage) ?? 'sent') : 'sent',
    })
  }
  return out.sort((a, b) => a.timestamp - b.timestamp)
}
