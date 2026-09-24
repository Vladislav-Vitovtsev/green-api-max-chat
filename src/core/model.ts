export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed'

export type Message = {
  id: string
  chatId: string
  direction: 'in' | 'out'
  text: string
  timestamp: number
  status: MessageStatus
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
