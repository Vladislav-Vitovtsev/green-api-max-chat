import { fixtures } from '../core/__fixtures__/notifications'
import { parseNotification } from '../core/notifications'
import type { DomainEvent } from '../core/model'
import { reduceEvent } from './reduce'
import { initialState, type AppState } from './store'

const withChat: AppState = {
  ...initialState,
  chats: { '10000001': { chatId: '10000001', phone: '79990000002', title: '+7 999 000-00-02', historyLoaded: true } },
  chatOrder: ['10000001'],
}
const ev = (b: Record<string, unknown>) => parseNotification(b) as DomainEvent
const apply = (s: AppState, e: DomainEvent): AppState => ({ ...s, ...reduceEvent(s, e) })

describe('reduceEvent', () => {
  it('входящее в известный чат: сообщение, имя чата, lastMessageAt', () => {
    const s = apply(withChat, ev(fixtures.incomingText))
    expect(s.orderByChat['10000001']).toEqual(['in-1'])
    expect(s.chats['10000001']!.title).toBe('Тест Тестов')
    expect(s.chats['10000001']!.lastMessageAt).toBe(1763115112000)
  })

  it('сообщение из чужого чата игнорируется', () => {
    expect(reduceEvent(initialState, ev(fixtures.incomingText))).toEqual({})
  })

  it('статус раньше сообщения → pendingStatus, потом применяется при приходе сообщения', () => {
    let s = apply(withChat, ev(fixtures.statusRead))
    expect(s.pendingStatus['out-1']).toBe('read')
    s = apply(s, ev(fixtures.outgoingApi))
    expect(s.messagesById['out-1']!.status).toBe('read')
    expect(s.pendingStatus['out-1']).toBeUndefined()
  })

  it('буфер статусов не откатывается', () => {
    let s = apply(withChat, ev(fixtures.statusRead))
    s = apply(s, ev(fixtures.statusDelivered))
    expect(s.pendingStatus['out-1']).toBe('read')
  })

  it('статус для чужого чата не буферизуется (чата нет в s.chats)', () => {
    expect(reduceEvent(initialState, ev(fixtures.statusRead))).toEqual({})
  })

  it('статус с chatId в формате с суффиксом (@c.us) буферизуется для известного чата так же, как без суффикса', () => {
    const s = reduceEvent(withChat, { type: 'status', chatId: '10000001@c.us', idMessage: 'out-9', status: 'delivered' })
    expect(s.pendingStatus).toEqual({ 'out-9': 'delivered' })
  })

  it('статус ниже уже применённого — патч {}, а не весь AppState', () => {
    let s = apply(withChat, ev(fixtures.outgoingApi))
    s = apply(s, ev(fixtures.statusRead))
    expect(s.messagesById['out-1']!.status).toBe('read')
    expect(reduceEvent(s, ev(fixtures.statusDelivered))).toEqual({})
  })

  it('повтор уже известного сообщения без изменений — патч {}, а не весь AppState', () => {
    const s = apply(withChat, ev(fixtures.outgoingApi))
    expect(reduceEvent(s, ev(fixtures.outgoingApi))).toEqual({})
  })

  it('эхо совпадающего по тексту local-*/failed сообщения того же чата (таймаут send) считается его подтверждением, без дубля', () => {
    const withLocal: AppState = {
      ...withChat,
      messagesById: { 'local-1': { id: 'local-1', chatId: '10000001', direction: 'out', text: 'тест', timestamp: 1_000, status: 'failed' } },
      orderByChat: { '10000001': ['local-1'] },
    }
    const echo: DomainEvent = {
      type: 'message',
      message: { id: 'real-1', chatId: '10000001', direction: 'out', text: 'тест', timestamp: 5_000, status: 'sent' },
    }
    const s = apply(withLocal, echo)
    expect(s.orderByChat['10000001']).toEqual(['real-1'])
    expect(s.messagesById['local-1']).toBeUndefined()
    expect(s.messagesById['real-1']!.status).toBe('sent')
  })

  it('эхо с другим текстом не матчится с local-*/failed того же чата — остаются оба', () => {
    const withLocal: AppState = {
      ...withChat,
      messagesById: { 'local-1': { id: 'local-1', chatId: '10000001', direction: 'out', text: 'тест', timestamp: 1_000, status: 'failed' } },
      orderByChat: { '10000001': ['local-1'] },
    }
    const echo: DomainEvent = {
      type: 'message',
      message: { id: 'real-1', chatId: '10000001', direction: 'out', text: 'другое', timestamp: 5_000, status: 'sent' },
    }
    const s = apply(withLocal, echo)
    expect(s.orderByChat['10000001']).toEqual(['local-1', 'real-1'])
    expect(s.messagesById['local-1']).toBeDefined()
  })

  it('эхо дальше ~2 минут от local-*/failed не матчится — остаются оба', () => {
    const withLocal: AppState = {
      ...withChat,
      messagesById: { 'local-1': { id: 'local-1', chatId: '10000001', direction: 'out', text: 'тест', timestamp: 1_000, status: 'failed' } },
      orderByChat: { '10000001': ['local-1'] },
    }
    const echo: DomainEvent = {
      type: 'message',
      message: { id: 'real-1', chatId: '10000001', direction: 'out', text: 'тест', timestamp: 1_000 + 3 * 60 * 1000, status: 'sent' },
    }
    const s = apply(withLocal, echo)
    expect(s.orderByChat['10000001']).toEqual(['local-1', 'real-1'])
    expect(s.messagesById['local-1']).toBeDefined()
  })

  it('эхо уже известного id (подтверждён ответом send) не крадёт другой ещё не подтверждённый local- с тем же текстом', () => {
    const s0: AppState = {
      ...withChat,
      messagesById: {
        'real-1': { id: 'real-1', chatId: '10000001', direction: 'out', text: 'ок', timestamp: 1_000, status: 'sent' },
        'local-2': { id: 'local-2', chatId: '10000001', direction: 'out', text: 'ок', timestamp: 1_500, status: 'pending' },
      },
      orderByChat: { '10000001': ['real-1', 'local-2'] },
    }
    // Повторное/запоздавшее уведомление об уже известном real-1 (подтверждён ответом sendMessage).
    const dupEcho: DomainEvent = {
      type: 'message',
      message: { id: 'real-1', chatId: '10000001', direction: 'out', text: 'ок', timestamp: 1_000, status: 'sent' },
    }
    const s = apply(s0, dupEcho)
    expect(s.messagesById['local-2']).toBeDefined()
    expect(s.messagesById['local-2']!.status).toBe('pending')
  })

  it('обе local- ещё pending: эхо матчится с самой старой неподтверждённой по одной за раз, после обоих эхо остаются два реальных id', () => {
    let s: AppState = {
      ...withChat,
      messagesById: {
        'local-1': { id: 'local-1', chatId: '10000001', direction: 'out', text: 'ок', timestamp: 1_000, status: 'pending' },
        'local-2': { id: 'local-2', chatId: '10000001', direction: 'out', text: 'ок', timestamp: 1_500, status: 'pending' },
      },
      orderByChat: { '10000001': ['local-1', 'local-2'] },
    }
    // Эхо ВТОРОГО сообщения приходит первым — матчится всё равно самая старая неподтверждённая (local-1).
    const echoSecond: DomainEvent = {
      type: 'message',
      message: { id: 'real-2', chatId: '10000001', direction: 'out', text: 'ок', timestamp: 2_000, status: 'sent' },
    }
    s = apply(s, echoSecond)
    expect(s.messagesById['local-1']).toBeUndefined()
    expect(s.messagesById['local-2']).toBeDefined()
    expect(s.messagesById['local-2']!.status).toBe('pending')
    expect(s.orderByChat['10000001']).toEqual(['local-2', 'real-2'])

    const echoFirst: DomainEvent = {
      type: 'message',
      message: { id: 'real-1', chatId: '10000001', direction: 'out', text: 'ок', timestamp: 1_000, status: 'sent' },
    }
    s = apply(s, echoFirst)
    expect(s.messagesById['local-2']).toBeUndefined()
    expect(s.messagesById['real-1']).toBeDefined()
    expect(s.messagesById['real-2']).toBeDefined()
    expect(s.orderByChat['10000001']).toEqual(['real-1', 'real-2'])
  })

  it('статус матчится по idMessage, даже если chatId события в другом формате', () => {
    let s = apply(withChat, ev(fixtures.outgoingApi))
    s = apply(s, { type: 'status', chatId: '10000001@c.us', idMessage: 'out-1', status: 'delivered' })
    expect(s.messagesById['out-1']!.status).toBe('delivered')
  })

  it('stateInstanceChanged не authorized → баннер, authorized → снимает', () => {
    let s = apply(withChat, { type: 'instanceState', state: 'notAuthorized' })
    expect(s.banner).toBe('notAuthorized')
    s = apply(s, { type: 'instanceState', state: 'authorized' })
    expect(s.banner).toBeNull()
  })

  it('quota → баннер', () => {
    expect(reduceEvent(withChat, { type: 'quota' })).toEqual({ banner: 'quota' })
  })
})
