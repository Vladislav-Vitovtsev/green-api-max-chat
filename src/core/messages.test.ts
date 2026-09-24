import type { Message } from './model'
import {
  applyStatus, confirmLocal, markFailed, nextStatus, removeMessage, upsertMessages, type MessagesState,
} from './messages'

const empty: MessagesState = { messagesById: {}, orderByChat: {} }
const msg = (id: string, timestamp: number, over: Partial<Message> = {}): Message => ({
  id, chatId: 'c', direction: 'out', text: id, timestamp, status: 'sent', ...over,
})
const order = (s: MessagesState) => s.orderByChat.c ?? []

describe('nextStatus', () => {
  it('только растёт', () => {
    expect(nextStatus('sent', 'delivered')).toBe('delivered')
    expect(nextStatus('read', 'delivered')).toBe('read')
    expect(nextStatus('pending', 'read')).toBe('read')
  })
  it('failed терминальный и принимается только до доставки', () => {
    expect(nextStatus('failed', 'read')).toBe('failed')
    expect(nextStatus('sent', 'failed')).toBe('failed')
    expect(nextStatus('pending', 'failed')).toBe('failed')
    expect(nextStatus('delivered', 'failed')).toBe('delivered')
  })
})

describe('upsertMessages', () => {
  it('сортирует по времени, равные — в порядке прихода', () => {
    let s = upsertMessages(empty, [msg('b', 200), msg('a', 100)])
    s = upsertMessages(s, [msg('c', 200)])
    expect(order(s)).toEqual(['a', 'b', 'c'])
  })

  it('дедуп по id: повтор не добавляет, статус не откатывается', () => {
    let s = upsertMessages(empty, [msg('a', 100, { status: 'read' })])
    s = upsertMessages(s, [msg('a', 100, { status: 'sent' })])
    expect(order(s)).toEqual(['a'])
    expect(s.messagesById.a!.status).toBe('read')
  })

  it('не меняет ссылку массива чата, если ничего не добавилось', () => {
    const s1 = upsertMessages(empty, [msg('a', 100)])
    const s2 = upsertMessages(s1, [msg('a', 100)])
    expect(s2.orderByChat.c).toBe(s1.orderByChat.c)
  })
})

describe('applyStatus', () => {
  it('null, если сообщения нет', () => {
    expect(applyStatus(empty, 'x', 'read')).toBeNull()
  })
  it('поднимает статус, не опускает', () => {
    const s = upsertMessages(empty, [msg('a', 100)])
    const s2 = applyStatus(s, 'a', 'read')!
    expect(s2.messagesById.a!.status).toBe('read')
    expect(applyStatus(s2, 'a', 'delivered')!.messagesById.a!.status).toBe('read')
  })
})

describe('confirmLocal', () => {
  it('переименовывает local-id в idMessage, pending → sent, место в ленте сохраняется', () => {
    let s = upsertMessages(empty, [msg('a', 100), msg('local-1', 150, { status: 'pending' })])
    s = confirmLocal(s, 'local-1', 'm1')
    expect(order(s)).toEqual(['a', 'm1'])
    expect(s.messagesById.m1!.status).toBe('sent')
    expect(s.messagesById['local-1']).toBeUndefined()
  })

  it('применяет статус из буфера (статус пришёл раньше ответа send)', () => {
    let s = upsertMessages(empty, [msg('local-1', 150, { status: 'pending' })])
    s = confirmLocal(s, 'local-1', 'm1', 'delivered')
    expect(s.messagesById.m1!.status).toBe('delivered')
  })

  it('echo пришло раньше ответа send: одна запись, лучший статус', () => {
    let s = upsertMessages(empty, [msg('local-1', 150, { status: 'pending' })])
    s = upsertMessages(s, [msg('m1', 151, { status: 'read' })])
    s = confirmLocal(s, 'local-1', 'm1')
    expect(order(s)).toEqual(['m1'])
    expect(s.messagesById.m1!.status).toBe('read')
  })

  it('несуществующий localId: состояние не меняется, возвращается та же ссылка', () => {
    const s = upsertMessages(empty, [msg('a', 100)])
    expect(confirmLocal(s, 'no-such-local', 'm1')).toBe(s)
  })
})

describe('markFailed и removeMessage', () => {
  it('markFailed ставит failed', () => {
    const s = markFailed(upsertMessages(empty, [msg('local-1', 1, { status: 'pending' })]), 'local-1')
    expect(s.messagesById['local-1']!.status).toBe('failed')
  })
  it('markFailed из sent → failed', () => {
    const s = markFailed(upsertMessages(empty, [msg('a', 1, { status: 'sent' })]), 'a')
    expect(s.messagesById.a!.status).toBe('failed')
  })
  it('markFailed после delivered не откатывает статус, ссылка состояния та же', () => {
    const s1 = upsertMessages(empty, [msg('a', 1, { status: 'delivered' })])
    const s2 = markFailed(s1, 'a')
    expect(s2.messagesById.a!.status).toBe('delivered')
    expect(s2).toBe(s1)
  })
  it('markFailed после read не откатывает статус, ссылка состояния та же', () => {
    const s1 = upsertMessages(empty, [msg('a', 1, { status: 'read' })])
    const s2 = markFailed(s1, 'a')
    expect(s2.messagesById.a!.status).toBe('read')
    expect(s2).toBe(s1)
  })
  it('removeMessage убирает из byId и ленты', () => {
    const s = removeMessage(upsertMessages(empty, [msg('a', 1), msg('b', 2)]), 'a')
    expect(order(s)).toEqual(['b'])
    expect(s.messagesById.a).toBeUndefined()
  })
})
