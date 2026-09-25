import { fixtures } from '../core/__fixtures__/notifications'
import { parseNotification } from '../core/notifications'
import type { Chat, DomainEvent, Message } from '../core/model'
import { markRead, recomputeLastMessageAt, reduceEvent, unreadOf } from './reduce'
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

  it('сообщение из группы, канала или бота в неизвестном чате игнорируется', () => {
    expect(reduceEvent(initialState, ev(fixtures.incomingGroupText))).toEqual({})
    expect(reduceEvent(initialState, ev(fixtures.incomingChannelText))).toEqual({})
    expect(reduceEvent(initialState, ev(fixtures.incomingBotText))).toEqual({})
  })

  it('chatType не выставлен (undefined) в неизвестном чате — fail-closed, чат не создаётся', () => {
    const noChatType: DomainEvent = {
      type: 'message',
      message: { id: 'in-x', chatId: '50000001', direction: 'in', text: 'привет', timestamp: 1_000, status: 'sent' },
    }
    expect(reduceEvent(initialState, noChatType)).toEqual({})
  })

  it('входящее от неизвестного собеседника создаёт чат: имя из chatName, телефон из senderPhoneNumber, сообщение видно', () => {
    const s = apply(initialState, ev(fixtures.incomingText))
    expect(s.chats['10000001']).toMatchObject({
      chatId: '10000001', phone: '79990000002', title: 'Тест Тестов', historyLoaded: false,
    })
    expect(s.chatOrder).toEqual(['10000001'])
    expect(s.orderByChat['10000001']).toEqual(['in-1'])
    expect(s.messagesById['in-1']).toBeDefined()
  })

  it('исходящее с телефона в неизвестный чат тоже создаёт его; телефон собеседника недоступен — пустой', () => {
    const s = apply(initialState, ev(fixtures.outgoingPhone))
    expect(s.chats['10000001']).toMatchObject({ chatId: '10000001', phone: '', title: 'Тест Тестов' })
  })

  it('неизвестный чат без имени и телефона получает title = chatId', () => {
    const s = apply(initialState, ev(fixtures.outgoingNoChatName))
    expect(s.chats['10000001']).toMatchObject({ chatId: '10000001', phone: '', title: '10000001' })
  })

  it('неизвестный чат без телефона, но с именем — title из имени, подстроки телефона нет', () => {
    const s = apply(initialState, ev(fixtures.incomingUnknownNoPhone))
    expect(s.chats['30000001']).toMatchObject({ chatId: '30000001', phone: '', title: 'Новый собеседник' })
  })

  it('плейсхолдер-заголовок (голый chatId) обновляется на имя, когда оно приходит следующим событием', () => {
    let s = apply(initialState, ev(fixtures.outgoingNoChatName))
    expect(s.chats['10000001']!.title).toBe('10000001')
    s = apply(s, ev(fixtures.incomingText))
    expect(s.chats['10000001']!.title).toBe('Тест Тестов')
  })

  const inMsg = (id: string, timestamp: number, extra: Partial<Message> = {}): DomainEvent => ({
    type: 'message',
    message: { id, chatId: '10000001', direction: 'in', text: id, timestamp, status: 'sent', ...extra },
  })

  it('входящее в неактивный чат даёт бейдж, второе входящее - 2', () => {
    let s = apply(withChat, ev(fixtures.incomingText))
    expect(unreadOf(s, '10000001')).toBe(1)
    s = apply(s, inMsg('in-2', 1763115113000))
    expect(unreadOf(s, '10000001')).toBe(2)
  })

  it('в активном чате бейджа нет', () => {
    const s = apply({ ...withChat, activeChatId: '10000001' }, ev(fixtures.incomingText))
    expect(unreadOf(s, '10000001')).toBe(0)
  })

  it('исходящее сообщение бейдж не создаёт', () => {
    const s = apply(withChat, ev(fixtures.outgoingApi))
    expect(unreadOf(s, '10000001')).toBe(0)
  })

  it('повторная доставка уже известного входящего не задваивает бейдж', () => {
    let s = apply(withChat, ev(fixtures.incomingText))
    s = apply(s, ev(fixtures.incomingText))
    expect(unreadOf(s, '10000001')).toBe(1)
  })

  it('удалённое входящее не считается', () => {
    const s = apply(withChat, inMsg('in-d', 2_000, { deleted: true, text: '' }))
    expect(unreadOf(s, '10000001')).toBe(0)
  })

  it('открытый чат: считаются только входящие новее readUpTo', () => {
    const read: AppState = { ...withChat, chats: { '10000001': { ...withChat.chats['10000001']!, readUpTo: 2_000 } } }
    let s = apply(read, inMsg('old', 1_500))
    s = apply(s, inMsg('new', 3_000))
    expect(unreadOf(s, '10000001')).toBe(1)
  })

  it('чат ни разу не открывали: серверный счётчик плюс входящие новее момента getChats', () => {
    const synced: AppState = {
      ...withChat,
      chats: { '10000001': { ...withChat.chats['10000001']!, serverUnread: 3, serverUnreadAt: 2_000 } },
    }
    let s = apply(synced, inMsg('journal', 1_500))
    expect(unreadOf(s, '10000001')).toBe(3)
    s = apply(s, inMsg('live', 3_000))
    expect(unreadOf(s, '10000001')).toBe(4)
  })

  it('новый собеседник из исходящего с телефона бейджа не получает', () => {
    const s = apply(initialState, ev(fixtures.outgoingPhone))
    expect(unreadOf(s, '10000001')).toBe(0)
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

  it('входящее в активный чат двигает readUpTo к метке этого сообщения', () => {
    const s = apply({ ...withChat, activeChatId: '10000001' }, ev(fixtures.incomingText))
    expect(s.chats['10000001']!.readUpTo).toBe(1763115112000)
  })

  it('readUpTo не откатывается назад более ранним сообщением', () => {
    const active: AppState = {
      ...withChat,
      activeChatId: '10000001',
      chats: { '10000001': { ...withChat.chats['10000001']!, readUpTo: 9_000_000_000_000 } },
    }
    const s = apply(active, ev(fixtures.incomingText))
    expect(s.chats['10000001']!.readUpTo).toBe(9_000_000_000_000)
  })
})

describe('markRead', () => {
  it('ставит readUpTo по последнему входящему, свои сообщения его не двигают', () => {
    let s = apply(withChat, ev(fixtures.incomingText))
    s = apply(s, ev(fixtures.outgoingApi))
    const chats = markRead(s, '10000001')
    expect(chats['10000001']!.readUpTo).toBe(1763115112000)
  })

  it('чат без входящих получает readUpTo 0: он отмечен как открытый', () => {
    expect(markRead(withChat, '10000001')['10000001']!.readUpTo).toBe(0)
  })

  it('ничего не изменилось - та же ссылка', () => {
    const read: AppState = { ...withChat, chats: { '10000001': { ...withChat.chats['10000001']!, readUpTo: 0 } } }
    expect(markRead(read, '10000001')).toBe(read.chats)
    expect(markRead(read, null)).toBe(read.chats)
  })
})

describe('recomputeLastMessageAt: самолечение lastMessageAt по хвосту orderByChat', () => {
  it('чат с сообщениями получает lastMessageAt из последнего сообщения, даже если персист хранил другое значение', () => {
    const chats: Record<string, Chat> = {
      '1': { chatId: '1', phone: '', title: 'А', historyLoaded: true, lastMessageAt: 9_999_999 },
    }
    const orderByChat = { '1': ['m1', 'm2'] }
    const messagesById = {
      m1: { id: 'm1', chatId: '1', direction: 'in' as const, text: 'a', timestamp: 1_000, status: 'sent' as const },
      m2: { id: 'm2', chatId: '1', direction: 'in' as const, text: 'b', timestamp: 2_000, status: 'sent' as const },
    }
    const out = recomputeLastMessageAt(chats, orderByChat, messagesById)
    expect(out['1']!.lastMessageAt).toBe(2_000)
  })

  it('чат без сообщений в orderByChat теряет lastMessageAt из персиста', () => {
    const chats: Record<string, Chat> = {
      '1': { chatId: '1', phone: '', title: 'А', historyLoaded: false, lastMessageAt: 500 },
      '2': { chatId: '2', phone: '', title: 'Б', historyLoaded: false },
    }
    const out = recomputeLastMessageAt(chats, {}, {})
    expect(out['1']!.lastMessageAt).toBeUndefined()
    expect(out['2']).toBe(chats['2'])
  })

  it('значение уже верное — ссылка на объект не меняется', () => {
    const chats: Record<string, Chat> = {
      '1': { chatId: '1', phone: '', title: 'А', historyLoaded: true, lastMessageAt: 2_000 },
    }
    const orderByChat = { '1': ['m1'] }
    const messagesById = { m1: { id: 'm1', chatId: '1', direction: 'in' as const, text: 'a', timestamp: 2_000, status: 'sent' as const } }
    expect(recomputeLastMessageAt(chats, orderByChat, messagesById)).toBe(chats)
  })
})
