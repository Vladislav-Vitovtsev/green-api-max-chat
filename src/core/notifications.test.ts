import { fixtures } from './__fixtures__/notifications'
import { mapStatus, parseNotification } from './notifications'

describe('parseNotification', () => {
  it('входящий текст', () => {
    expect(parseNotification(fixtures.incomingText)).toEqual({
      type: 'message',
      chatName: 'Тест Тестов',
      message: {
        id: 'in-1', chatId: '10000001', direction: 'in', text: 'Привет',
        timestamp: 1763115112000, status: 'sent',
      },
    })
  })

  it('extendedTextMessage берёт text', () => {
    const ev = parseNotification(fixtures.incomingExtended)
    expect(ev?.type === 'message' && ev.message.text).toBe('Ссылка https://x.ru')
  })

  it('картинка → заглушка', () => {
    const ev = parseNotification(fixtures.incomingImage)
    expect(ev?.type === 'message' && ev.message.text).toBe('[изображение]')
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

  it('статус доставки', () => {
    expect(parseNotification(fixtures.statusDelivered)).toEqual({
      type: 'status', chatId: '10000001', idMessage: 'out-1', status: 'delivered',
    })
  })

  it('смена состояния инстанса и квота', () => {
    expect(parseNotification(fixtures.stateChanged)).toEqual({ type: 'instanceState', state: 'notAuthorized' })
    expect(parseNotification(fixtures.quota)).toEqual({ type: 'quota' })
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
