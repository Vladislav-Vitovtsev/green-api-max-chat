import type { RawHistoryItem } from '../api/types'
import { mapHistory, maxRawHistoryTimestamp } from './history'

const item = (over: Partial<RawHistoryItem>): RawHistoryItem => ({
  type: 'incoming', idMessage: 'x', timestamp: 100, typeMessage: 'textMessage', chatId: '1', textMessage: 'a', ...over,
})

describe('mapHistory', () => {
  it('переворачивает в хронологический порядок и переводит время в мс', () => {
    const r = mapHistory([item({ idMessage: 'b', timestamp: 200 }), item({ idMessage: 'a', timestamp: 100 })], '1')
    expect(r.map((m) => m.id)).toEqual(['a', 'b'])
    expect(r[0]!.timestamp).toBe(100_000)
  })

  it('исходящее: статус из statusMessage, по умолчанию sent', () => {
    const r = mapHistory(
      [item({ idMessage: 'o1', type: 'outgoing', statusMessage: 'read' }), item({ idMessage: 'o2', type: 'outgoing', timestamp: 101 })],
      '1',
    )
    expect(r.map((m) => [m.direction, m.status])).toEqual([['out', 'read'], ['out', 'sent']])
  })

  it('не-текст без подписи → метка медиа, текст пустой', () => {
    const [m] = mapHistory([item({ typeMessage: 'videoMessage', textMessage: undefined })], '1')
    expect(m!.mediaLabel).toBe('🎥 Видео')
    expect(m!.text).toBe('')
  })

  it('не-текст с подписью → метка медиа отдельно от текста подписи', () => {
    const [m] = mapHistory([item({ typeMessage: 'videoMessage', textMessage: undefined, caption: 'Момент' })], '1')
    expect(m!.mediaLabel).toBe('🎥 Видео')
    expect(m!.text).toBe('Момент')
  })

  it('стикер с подписью → метка «Стикер», подпись отдельным текстом', () => {
    const [m] = mapHistory([item({ typeMessage: 'stickerMessage', textMessage: undefined, caption: 'привет!' })], '1')
    expect(m!.mediaLabel).toBe('Стикер')
    expect(m!.text).toBe('привет!')
  })

  it('подпись из пробелов → как без подписи', () => {
    const [m] = mapHistory([item({ typeMessage: 'videoMessage', textMessage: undefined, caption: '   ' })], '1')
    expect(m!.mediaLabel).toBe('🎥 Видео')
    expect(m!.text).toBe('')
  })

  it('isDeleted → text пустой, флаг deleted, метка медиа не выставляется', () => {
    const [m] = mapHistory([item({ typeMessage: 'imageMessage', textMessage: undefined, caption: 'фото', isDeleted: true })], '1')
    expect(m!.deleted).toBe(true)
    expect(m!.text).toBe('')
    expect(m!.mediaLabel).toBeUndefined()
  })

  it('isEdited → флаг edited', () => {
    const [m] = mapHistory([item({ isEdited: true })], '1')
    expect(m!.edited).toBe(true)
  })

  it('без isDeleted/isEdited → флаги false', () => {
    const [m] = mapHistory([item({})], '1')
    expect(m!.deleted).toBe(false)
    expect(m!.edited).toBe(false)
  })

  it('chatId берётся из аргумента запроса, а не из элемента', () => {
    const r = mapHistory([item({ idMessage: 'a', chatId: 'другой-формат-или-пусто' })], '42')
    expect(r[0]!.chatId).toBe('42')
  })

  it('пропускает элементы без idMessage, но не без chatId в самом элементе', () => {
    expect(mapHistory([item({ idMessage: '' })], '1')).toEqual([])
    const r = mapHistory([item({ chatId: '' })], '1')
    expect(r.map((m) => m.id)).toEqual(['x'])
    expect(r[0]!.chatId).toBe('1')
  })

  it('пропускает не-объекты в массиве, без исключений', () => {
    const r = mapHistory([null, 5, item({ idMessage: 'ok' })] as never, '1')
    expect(r.map((m) => m.id)).toEqual(['ok'])
  })

  it('quotedMessage → цитата с id/текстом, fromMe по совпадению участника с chatId', () => {
    const [m] = mapHistory(
      [item({ quotedMessage: { stanzaId: 'q1', participant: '1', typeMessage: 'textMessage', textMessage: 'Работает?' } })],
      '1',
    )
    expect(m!.quote).toEqual({ id: 'q1', text: 'Работает?', mediaLabel: undefined, fromMe: false })
  })

  it('quotedMessage медиа-типа → mediaLabel вместо текста, участник другой — fromMe true', () => {
    const [m] = mapHistory(
      [item({ quotedMessage: { stanzaId: 'q2', participant: 'other', typeMessage: 'imageMessage', caption: 'Момент' } })],
      '1',
    )
    expect(m!.quote).toEqual({ id: 'q2', text: 'Момент', mediaLabel: '📷 Фото', fromMe: true })
  })

  it('без quotedMessage → quote не выставляется', () => {
    const [m] = mapHistory([item({})], '1')
    expect(m!.quote).toBeUndefined()
  })

  it('deletedMessage/editedMessage — служебные маркеры, а не сообщения: пропускаются', () => {
    const r = mapHistory(
      [
        item({ idMessage: 'del-1', typeMessage: 'deletedMessage' }),
        item({ idMessage: 'edit-1', typeMessage: 'editedMessage' }),
        item({ idMessage: 'ok', typeMessage: 'textMessage' }),
      ],
      '1',
    )
    expect(r.map((m) => m.id)).toEqual(['ok'])
  })
})

describe('maxRawHistoryTimestamp', () => {
  it('учитывает timestamp маркеров deletedMessage/editedMessage, которые mapHistory отфильтровывает', () => {
    const raw = [
      item({ idMessage: 'a', typeMessage: 'textMessage', timestamp: 100 }),
      item({ idMessage: 'del-1', typeMessage: 'deletedMessage', timestamp: 300 }),
    ]
    expect(mapHistory(raw, '1').map((m) => m.id)).toEqual(['a'])
    expect(maxRawHistoryTimestamp(raw)).toBe(300_000)
  })

  it('пустой массив → 0', () => {
    expect(maxRawHistoryTimestamp([])).toBe(0)
  })

  it('пропускает элементы без числового timestamp и не-объекты', () => {
    expect(maxRawHistoryTimestamp([item({ timestamp: undefined as unknown as number })])).toBe(0)
    expect(maxRawHistoryTimestamp([null, 5] as never)).toBe(0)
  })
})
