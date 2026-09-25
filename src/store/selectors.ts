import { unreadOf } from './reduce/reduce'
import type { AppState } from './store'

export const selectChatOrder = (s: AppState) => s.chatOrder
export const selectChat = (chatId: string) => (s: AppState) => s.chats[chatId]
export const selectActiveChatId = (s: AppState) => s.activeChatId
export const selectOrder = (chatId: string) => (s: AppState) => s.orderByChat[chatId]
export const selectMessage = (id: string) => (s: AppState) => s.messagesById[id]
export const selectLastMessage = (chatId: string) => (s: AppState) => {
  const order = s.orderByChat[chatId]
  const last = order?.[order.length - 1]
  return last ? s.messagesById[last] : undefined
}
export const selectBanner = (s: AppState) => s.banner
export const selectCredentials = (s: AppState) => s.credentials
export const selectUnread = (chatId: string) => (s: AppState) => unreadOf(s, chatId)
