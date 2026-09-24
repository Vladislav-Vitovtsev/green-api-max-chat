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
