export type Credentials = {
  apiUrl: string
  idInstance: string
  apiTokenInstance: string
}

export type RawNotification = {
  receiptId: number
  body: Record<string, unknown>
}

export type RawHistoryItem = {
  type: 'incoming' | 'outgoing'
  idMessage: string
  timestamp: number
  typeMessage: string
  chatId: string
  textMessage?: string
  caption?: string
  statusMessage?: string
  senderName?: string
  sendByApi?: boolean
}
