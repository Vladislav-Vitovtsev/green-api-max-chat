import type { Message } from '../model'
import {
  applyStatus, confirmLocal, keepInFlight, markFailed, nextStatus, reconcileChatWithHistory, removeMessage,
  upsertMessages, upsertMessagesWithEcho, type MessagesState,
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

  it('дедуп по id: свежий непустой текст заменяет старый плейсхолдер', () => {
    let s = upsertMessages(empty, [msg('a', 100, { text: '[изображение]' })])
    s = upsertMessages(s, [msg('a', 100, { text: '📷 Фото' })])
    expect(s.messagesById.a!.text).toBe('📷 Фото')
  })

  it('дедуп по id: пустой входящий текст не затирает существующий', () => {
    let s = upsertMessages(empty, [msg('a', 100, { text: '📷 Фото' })])
    s = upsertMessages(s, [msg('a', 100, { text: '' })])
    expect(s.messagesById.a!.text).toBe('📷 Фото')
  })

  it('дедуп по id: берёт входящий mediaLabel, когда он присутствует', () => {
    let s = upsertMessages(empty, [msg('a', 100, { text: 'Момент', mediaLabel: '🎥 Видео' })])
    s = upsertMessages(s, [msg('a', 100, { text: 'Момент', mediaLabel: '📷 Фото' })])
    expect(s.messagesById.a!.mediaLabel).toBe('📷 Фото')
  })

  it('дедуп по id: без нового mediaLabel старый сохраняется', () => {
    let s = upsertMessages(empty, [msg('a', 100, { text: 'a', mediaLabel: '🎥 Видео', status: 'sent' })])
    s = upsertMessages(s, [msg('a', 100, { text: 'a', status: 'delivered' })])
    expect(s.messagesById.a!.mediaLabel).toBe('🎥 Видео')
  })

  it('дедуп по id: повторная загрузка истории с isDeleted затирает текст пустой строкой', () => {
    let s = upsertMessages(empty, [msg('a', 100, { text: 'привет', direction: 'in' })])
    s = upsertMessages(s, [msg('a', 100, { text: '', direction: 'in', deleted: true })])
    expect(s.messagesById.a!.text).toBe('')
    expect(s.messagesById.a!.deleted).toBe(true)
  })

  it('дедуп по id: deleted монотонен — повторная загрузка без флага не воскрешает сообщение', () => {
    let s = upsertMessages(empty, [msg('a', 100, { text: 'привет', direction: 'in', deleted: true })])
    s = upsertMessages(s, [msg('a', 100, { text: 'привет', direction: 'in', deleted: false })])
    expect(s.messagesById.a!.deleted).toBe(true)
    expect(s.messagesById.a!.text).toBe('')
  })

  it('дедуп по id: edited монотонен — повторная загрузка без флага не снимает пометку «ред.»', () => {
    let s = upsertMessages(empty, [msg('a', 100, { text: 'привет', direction: 'in', edited: true })])
    s = upsertMessages(s, [msg('a', 100, { text: 'привет', direction: 'in', edited: false })])
    expect(s.messagesById.a!.edited).toBe(true)
  })

  it('дедуп по id: у удалённого медиасообщения после мержа нет mediaLabel', () => {
    let s = upsertMessages(empty, [msg('a', 100, { text: 'Момент', direction: 'in', mediaLabel: '🎥 Видео' })])
    s = upsertMessages(s, [msg('a', 100, { text: '', direction: 'in', deleted: true })])
    expect(s.messagesById.a!.mediaLabel).toBeUndefined()
  })

  it('дедуп по id: входящая копия с mediaLabel авторитетна по тексту даже при пустой строке — старая подпись-дубликат не переживает', () => {
    let s = upsertMessages(empty, [msg('a', 100, { text: '📷 Фото', direction: 'in' })])
    s = upsertMessages(s, [msg('a', 100, { text: '', direction: 'in', mediaLabel: '📷 Фото' })])
    expect(s.messagesById.a!.text).toBe('')
    expect(s.messagesById.a!.mediaLabel).toBe('📷 Фото')
  })

  it('дедуп по id: входящая копия с mediaLabel и непустым текстом — подпись обновляется', () => {
    let s = upsertMessages(empty, [msg('a', 100, { text: '📷 Фото', direction: 'in' })])
    s = upsertMessages(s, [msg('a', 100, { text: 'Отпуск', direction: 'in', mediaLabel: '📷 Фото' })])
    expect(s.messagesById.a!.text).toBe('Отпуск')
  })

  it('дедуп по id: quote сохраняется, если повторная копия его не несёт', () => {
    let s = upsertMessages(empty, [msg('a', 100, { quote: { id: 'q1', text: 'Работает?', fromMe: false } })])
    s = upsertMessages(s, [msg('a', 100, {})])
    expect(s.messagesById.a!.quote).toEqual({ id: 'q1', text: 'Работает?', fromMe: false })
  })

  it('дедуп по id: новый quote во входящей копии заменяет старый', () => {
    let s = upsertMessages(empty, [msg('a', 100, { quote: { id: 'q1', text: 'старая', fromMe: false } })])
    s = upsertMessages(s, [msg('a', 100, { quote: { id: 'q2', text: 'новая', fromMe: true } })])
    expect(s.messagesById.a!.quote).toEqual({ id: 'q2', text: 'новая', fromMe: true })
  })

  it('дедуп по id: своё исходящее — серверный timestamp репозиционирует сообщение в orderByChat', () => {
    let s = upsertMessages(empty, [msg('out-1', 100), msg('in-1', 150, { direction: 'in' })])
    expect(order(s)).toEqual(['out-1', 'in-1'])
    s = upsertMessages(s, [msg('out-1', 200, { status: 'delivered' })])
    expect(order(s)).toEqual(['in-1', 'out-1'])
    expect(s.messagesById['out-1']!.timestamp).toBe(200)
  })

  it('дедуп по id: своё отредактированное сообщение не репозиционируется по timestamp правки', () => {
    let s = upsertMessages(empty, [msg('out-1', 100), msg('in-1', 150, { direction: 'in' })])
    expect(order(s)).toEqual(['out-1', 'in-1'])
    s = upsertMessages(s, [msg('out-1', 500, { edited: true, text: 'исправлено' })])
    expect(order(s)).toEqual(['out-1', 'in-1'])
    expect(s.messagesById['out-1']!.timestamp).toBe(100)
    expect(s.messagesById['out-1']!.edited).toBe(true)
    expect(s.messagesById['out-1']!.text).toBe('исправлено')
  })

  it('дедуп по id: входящее — повторная копия с другим timestamp позицию не меняет', () => {
    let s = upsertMessages(empty, [msg('in-1', 100, { direction: 'in' }), msg('a', 150)])
    expect(order(s)).toEqual(['in-1', 'a'])
    s = upsertMessages(s, [msg('in-1', 500, { direction: 'in' })])
    expect(order(s)).toEqual(['in-1', 'a'])
    expect(s.messagesById['in-1']!.timestamp).toBe(100)
  })

  it('дедуп по id: повторный апсерт с идентичным по содержимому, но новым по ссылке quote — та же ссылка стейта', () => {
    const s1 = upsertMessages(empty, [msg('a', 100, { quote: { id: 'q1', text: 'Работает?', fromMe: false } })])
    const s2 = upsertMessages(s1, [msg('a', 100, { quote: { id: 'q1', text: 'Работает?', fromMe: false } })])
    expect(s2).toBe(s1)
    expect(s2.messagesById.a).toBe(s1.messagesById.a)
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

describe('reconcileChatWithHistory', () => {
  it('устаревший id внутри окна истории удаляется', () => {
    let s = upsertMessages(empty, [msg('stale', 150, { text: '' }), msg('a', 100)])
    s = reconcileChatWithHistory(s, 'c', [msg('a', 100), msg('b', 200)], keepInFlight)
    expect(order(s)).toEqual(['a', 'b'])
    expect(s.messagesById.stale).toBeUndefined()
  })

  it('сообщение старше окна истории сохраняется', () => {
    let s = upsertMessages(empty, [msg('old', 50), msg('a', 200)])
    s = reconcileChatWithHistory(s, 'c', [msg('a', 200)], keepInFlight)
    expect(order(s)).toEqual(['old', 'a'])
    expect(s.messagesById.old).toBeDefined()
  })

  it('подтверждённое своё сообщение новее окна истории сохраняется (ещё не долетело до getChatHistory)', () => {
    let s = upsertMessages(empty, [msg('a', 100), msg('fresh', 500, { status: 'sent' })])
    s = reconcileChatWithHistory(s, 'c', [msg('a', 100)], keepInFlight)
    expect(order(s)).toEqual(['a', 'fresh'])
    expect(s.messagesById.fresh).toBeDefined()
  })

  it('локальное pending-сообщение внутри окна истории сохраняется', () => {
    let s = upsertMessages(empty, [msg('local-1', 250, { status: 'pending' })])
    s = reconcileChatWithHistory(s, 'c', [msg('a', 200)], keepInFlight)
    expect(order(s)).toEqual(['a', 'local-1'])
    expect(s.messagesById['local-1']).toBeDefined()
  })

  it('пустая история не меняет стейт (та же ссылка)', () => {
    const s = upsertMessages(empty, [msg('a', 100)])
    expect(reconcileChatWithHistory(s, 'c', [], keepInFlight)).toBe(s)
  })

  it('массив порядка чата обновляется под новую историю', () => {
    let s = upsertMessages(empty, [msg('stale', 150, { text: '' }), msg('a', 100)])
    s = reconcileChatWithHistory(s, 'c', [msg('a', 100), msg('b', 300)], keepInFlight)
    expect(order(s)).toEqual(['a', 'b'])
  })

  it('чужой чат не трогает, устаревшее сообщение другого чата остаётся', () => {
    let s = upsertMessages(empty, [{ ...msg('other', 100), chatId: 'other-chat' }])
    s = reconcileChatWithHistory(s, 'c', [msg('a', 200)], keepInFlight)
    expect(s.messagesById.other).toBeDefined()
  })

  it('ничего не меняется — возвращается та же ссылка стейта', () => {
    const s = upsertMessages(empty, [msg('a', 200)])
    expect(reconcileChatWithHistory(s, 'c', [msg('a', 200)], keepInFlight)).toBe(s)
  })

  it('rawMaxTs расширяет верхнюю границу окна — ловит бабл от маркера, отфильтрованного mapHistory', () => {
    let s = upsertMessages(empty, [msg('a', 100), msg('marker-bubble', 200, { text: '' })])
    s = reconcileChatWithHistory(s, 'c', [msg('a', 100)], keepInFlight, 300)
    expect(s.messagesById['marker-bubble']).toBeUndefined()
    expect(order(s)).toEqual(['a'])
  })

  it('без rawMaxTs то же сообщение (новее toTs по items) не считается протухшим', () => {
    let s = upsertMessages(empty, [msg('a', 100), msg('marker-bubble', 200, { text: '' })])
    s = reconcileChatWithHistory(s, 'c', [msg('a', 100)], keepInFlight)
    expect(s.messagesById['marker-bubble']).toBeDefined()
  })
})

describe('upsertMessagesWithEcho в режиме журналов (onlyFailed)', () => {
  const local = (id: string, timestamp: number, status: Message['status']) => msg(id, timestamp, { text: 'ок', status })

  it('pending local- не склеивается с эхом из журнала: его подтвердит ответ sendMessage', () => {
    const s0 = upsertMessages(empty, [local('local-1', 1_000, 'pending')])
    const s = upsertMessagesWithEcho(s0, [msg('real-1', 1_100, { text: 'ок' })], true)
    expect(s.messagesById['local-1']).toBeDefined()
    expect(s.messagesById['real-1']).toBeDefined()
  })

  it('из двух failed с тем же текстом склеивается ближайший по времени, а не первый', () => {
    const s0 = upsertMessages(empty, [local('local-1', 1_000, 'failed'), local('local-2', 60_000, 'failed')])
    const s = upsertMessagesWithEcho(s0, [msg('real-2', 61_000, { text: 'ок' })], true)
    expect(s.messagesById['local-1']).toBeDefined()
    expect(s.messagesById['local-2']).toBeUndefined()
    expect(s.messagesById['real-2']!.status).toBe('sent')
  })
})
