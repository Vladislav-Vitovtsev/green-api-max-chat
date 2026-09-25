const instanceData = { idInstance: 3100000000, wid: '79990000001@c.us', typeInstance: 'v3' }
const sender = {
  chatId: '10000001', chatName: 'Тест Тестов', chatType: 'user', sender: '10000001',
  senderName: 'Тест Тестов', senderType: 'user', senderContactName: '', senderPhoneNumber: 79990000002,
}
const senderNoChatName = { ...sender, chatName: '', senderName: 'Владелец' }

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
  incomingImageCaption: {
    typeWebhook: 'incomingMessageReceived', instanceData, timestamp: 1763115122, idMessage: 'in-4',
    senderData: sender,
    messageData: { typeMessage: 'imageMessage', fileMessageData: { downloadUrl: 'https://x/y.jpg', caption: 'Отпуск' } },
  },
  incomingStickerCaption: {
    typeWebhook: 'incomingMessageReceived', instanceData, timestamp: 1763115123, idMessage: 'in-5',
    senderData: sender,
    messageData: { typeMessage: 'stickerMessage', stickerMessageData: { downloadUrl: 'https://x/s.webp', caption: 'привет!' } },
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
  outgoingNoChatName: {
    typeWebhook: 'outgoingAPIMessageReceived', instanceData, timestamp: 1763115121, idMessage: 'out-3',
    senderData: senderNoChatName,
    messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: 'от владельца' } },
  },
  incomingTextWithQuote: {
    typeWebhook: 'incomingMessageReceived', instanceData, timestamp: 1763115126, idMessage: 'in-8',
    senderData: sender,
    messageData: {
      typeMessage: 'textMessage', textMessageData: { textMessage: 'Ответ на вопрос' },
      quotedMessage: { stanzaId: 'q1', participant: '10000001', typeMessage: 'textMessage', textMessage: 'Работает?' },
    },
  },
  incomingExtendedWithNestedQuote: {
    typeWebhook: 'incomingMessageReceived', instanceData, timestamp: 1763115127, idMessage: 'in-9',
    senderData: sender,
    messageData: {
      typeMessage: 'extendedTextMessage',
      extendedTextMessageData: {
        text: 'Согласен',
        quotedMessage: { stanzaId: 'q2', participant: 'me-wid', typeMessage: 'imageMessage', caption: 'Фото места' },
      },
    },
  },
  incomingDeletedMarker: {
    typeWebhook: 'incomingMessageReceived', instanceData, timestamp: 1763115124, idMessage: 'in-6',
    senderData: sender,
    messageData: { typeMessage: 'deletedMessage', deletedMessageData: { stanzaId: 'in-1' } },
  },
  incomingEditedMarker: {
    typeWebhook: 'incomingMessageReceived', instanceData, timestamp: 1763115125, idMessage: 'in-7',
    senderData: sender,
    messageData: { typeMessage: 'editedMessage', editedMessageData: { stanzaId: 'in-1', messageType: 'textMessage', textMessageData: { textMessage: 'правка' } } },
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
