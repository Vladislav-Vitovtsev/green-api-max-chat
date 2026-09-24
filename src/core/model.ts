export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed'

export type Quote = { id: string; text: string; mediaLabel?: string; fromMe: boolean }

export type Message = {
  id: string
  chatId: string
  direction: 'in' | 'out'
  text: string
  timestamp: number
  status: MessageStatus
  mediaLabel?: string
  deleted?: boolean
  edited?: boolean
  quote?: Quote
}

export type Chat = {
  chatId: string
  phone: string
  title: string
  historyLoaded: boolean
  lastMessageAt?: number
}

export type DomainEvent =
  | { type: 'message'; message: Message; chatName?: string }
  | { type: 'status'; chatId: string; idMessage: string; status: MessageStatus }
  | { type: 'instanceState'; state: string }
  | { type: 'quota' }
