import { fixtures } from './__fixtures__/notifications'
import { mapStatus, parseNotification } from './notifications'

describe('parseNotification', () => {
  it('входящий текст', () => {
    expect(parseNotification(fixtures.incomingText)).toEqual({
      type: 'message',
      chatName: 'Тест Тестов',
      chatType: 'user',
      peerPhone: '79990000002',
      message: {
        id: 'in-1', chatId: '10000001', direction: 'in', text: 'Привет',
        timestamp: 1763115112000, status: 'sent',
      },
    })
  })

  it('группа, канал и бот: chatType из senderData.chatType', () => {
    const group = parseNotification(fixtures.incomingGroupText)
    expect(group?.type === 'message' && group.chatType).toBe('group')
    const channel = parseNotification(fixtures.incomingChannelText)
    expect(channel?.type === 'message' && channel.chatType).toBe('channel')
    const bot = parseNotification(fixtures.incomingBotText)
    expect(bot?.type === 'message' && bot.chatType).toBe('bot')
  })

  it('исходящее не несёт peerPhone, даже если senderPhoneNumber есть в senderData', () => {
    for (const f of [fixtures.outgoingApi, fixtures.outgoingPhone]) {
      const ev = parseNotification(f)
      expect(ev?.type === 'message' && ev.peerPhone).toBeUndefined()
    }
  })

  it('senderPhoneNumber отсутствует или 0 → peerPhone не выставляется', () => {
    const ev = parseNotification(fixtures.incomingUnknownNoPhone)
    expect(ev?.type === 'message' && ev.peerPhone).toBeUndefined()
    expect(ev?.type === 'message' && ev.chatName).toBe('Новый собеседник')
  })

  it('extendedTextMessage берёт text', () => {
    const ev = parseNotification(fixtures.incomingExtended)
    expect(ev?.type === 'message' && ev.message.text).toBe('Ссылка https://x.ru')
  })

  it('картинка без подписи → метка медиа, текст пустой', () => {
    const ev = parseNotification(fixtures.incomingImage)
    expect(ev?.type === 'message' && ev.message.mediaLabel).toBe('📷 Фото')
    expect(ev?.type === 'message' && ev.message.text).toBe('')
  })

  it('картинка с подписью → метка медиа отдельно от текста подписи', () => {
    const ev = parseNotification(fixtures.incomingImageCaption)
    expect(ev?.type === 'message' && ev.message.mediaLabel).toBe('📷 Фото')
    expect(ev?.type === 'message' && ev.message.text).toBe('Отпуск')
  })

  it('стикер с подписью → метка «Стикер», подпись отдельным текстом', () => {
    const ev = parseNotification(fixtures.incomingStickerCaption)
    expect(ev?.type === 'message' && ev.message.mediaLabel).toBe('Стикер')
    expect(ev?.type === 'message' && ev.message.text).toBe('привет!')
  })

  it('исходящее из API и с телефона → direction out, status sent', () => {
    for (const f of [fixtures.outgoingApi, fixtures.outgoingPhone]) {
      const ev = parseNotification(f)
      expect(ev?.type).toBe('message')
      if (ev?.type === 'message') {
        expect(ev.message.direction).toBe('out')
        expect(ev.message.status).toBe('sent')
      }
    }
  })

  it('исходящее без chatName не подставляет senderName (это владелец инстанса, не собеседник)', () => {
    const ev = parseNotification(fixtures.outgoingNoChatName)
    expect(ev?.type === 'message' && ev.chatName).toBeUndefined()
  })

  it('статус доставки', () => {
    expect(parseNotification(fixtures.statusDelivered)).toEqual({
      type: 'status', chatId: '10000001', idMessage: 'out-1', status: 'delivered',
    })
  })

  it('смена состояния инстанса и квота', () => {
    expect(parseNotification(fixtures.stateChanged)).toEqual({ type: 'instanceState', state: 'notAuthorized' })
    expect(parseNotification(fixtures.quota)).toEqual({ type: 'quota' })
  })

  it('quotedMessage внутри messageData → цитата, fromMe по совпадению участника с chatId', () => {
    const ev = parseNotification(fixtures.incomingTextWithQuote)
    expect(ev?.type === 'message' && ev.message.quote).toEqual({ id: 'q1', text: 'Работает?', mediaLabel: undefined, fromMe: false })
  })

  it('quotedMessage, вложенный в extendedTextMessageData, тоже распознаётся; медиа-тип даёт mediaLabel', () => {
    const ev = parseNotification(fixtures.incomingExtendedWithNestedQuote)
    expect(ev?.type === 'message' && ev.message.quote).toEqual({ id: 'q2', text: 'Фото места', mediaLabel: '📷 Фото', fromMe: true })
  })

  it('без quotedMessage → quote не выставляется', () => {
    const ev = parseNotification(fixtures.incomingText)
    expect(ev?.type === 'message' && ev.message.quote).toBeUndefined()
  })

  it('deletedMessage/editedMessage внутри webhook о сообщении — служебный маркер, не сообщение', () => {
    expect(parseNotification(fixtures.incomingDeletedMarker)).toBeNull()
    expect(parseNotification(fixtures.incomingEditedMarker)).toBeNull()
  })

  it('мусор и неизвестные типы → null, без исключений', () => {
    expect(parseNotification({})).toBeNull()
    expect(parseNotification({ typeWebhook: 'deviceInfo' })).toBeNull()
    expect(parseNotification({ typeWebhook: 'incomingMessageReceived' })).toBeNull()
    expect(parseNotification({ typeWebhook: 'outgoingMessageStatus', idMessage: 'x' })).toBeNull()
  })

  it('null и undefined → null, без исключений', () => {
    expect(parseNotification(null as never)).toBeNull()
    expect(parseNotification(undefined as never)).toBeNull()
  })
})

describe('mapStatus', () => {
  it.each([
    ['sent', 'sent'], ['delivered', 'delivered'], ['read', 'read'],
    ['failed', 'failed'], ['noAccount', 'failed'], ['notInGroup', 'failed'], ['suspended', 'failed'],
    ['weird', null], [undefined, null],
  ] as const)('%s → %s', (raw, expected) => {
    expect(mapStatus(raw)).toBe(expected)
  })
})
