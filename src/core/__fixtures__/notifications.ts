const instanceData = { idInstance: 3100000000, wid: '79990000001@c.us', typeInstance: 'v3' }
const sender = {
  chatId: '10000001', chatName: 'Тест Тестов', chatType: 'user', sender: '10000001',
  senderName: 'Тест Тестов', senderType: 'user', senderContactName: '', senderPhoneNumber: 79990000002,
}

export const fixtures = {
  incomingText: {
    typeWebhook: 'incomingMessageReceived', instanceData, timestamp: 1763115112, idMessage: 'in-1',
    senderData: sender,
    messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: 'Привет' } },
  },
  incomingExtended: {
    typeWebhook: 'incomingMessageReceived', instanceData, timestamp: 1763115113, idMessage: 'in-2',
    senderData: sender,
    messageData: { typeMessage: 'extendedTextMessage', extendedTextMessageData: { text: 'Ссылка https://x.ru' } },
  },
  incomingImage: {
    typeWebhook: 'incomingMessageReceived', instanceData, timestamp: 1763115114, idMessage: 'in-3',
    senderData: sender,
    messageData: { typeMessage: 'imageMessage', fileMessageData: { downloadUrl: 'https://x/y.jpg', caption: '' } },
  },
  outgoingApi: {
    typeWebhook: 'outgoingAPIMessageReceived', instanceData, timestamp: 1763115115, idMessage: 'out-1',
    senderData: sender,
    messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: 'тест max-chat' } },
  },
  outgoingPhone: {
    typeWebhook: 'outgoingMessageReceived', instanceData, timestamp: 1763115116, idMessage: 'out-2',
    senderData: sender,
    messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: 'с телефона' } },
  },
  statusDelivered: {
    typeWebhook: 'outgoingMessageStatus', instanceData, timestamp: 1763115117,
    idMessage: 'out-1', status: 'delivered', chatId: '10000001', sendByApi: true,
  },
  statusRead: {
    typeWebhook: 'outgoingMessageStatus', instanceData, timestamp: 1763115118,
    idMessage: 'out-1', status: 'read', chatId: '10000001', sendByApi: true,
  },
  stateChanged: { typeWebhook: 'stateInstanceChanged', instanceData, timestamp: 1763115119, stateInstance: 'notAuthorized' },
  quota: { typeWebhook: 'quotaExceeded', instanceData, timestamp: 1763115120, quotaData: {} },
} satisfies Record<string, Record<string, unknown>>
