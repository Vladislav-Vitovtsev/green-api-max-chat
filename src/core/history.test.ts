import type { RawHistoryItem } from '../api/types'
import { mapHistory } from './history'

const item = (over: Partial<RawHistoryItem>): RawHistoryItem => ({
  type: 'incoming', idMessage: 'x', timestamp: 100, typeMessage: 'textMessage', chatId: '1', textMessage: 'a', ...over,
})

describe('mapHistory', () => {
  it('переворачивает в хронологический порядок и переводит время в мс', () => {
    const r = mapHistory([item({ idMessage: 'b', timestamp: 200 }), item({ idMessage: 'a', timestamp: 100 })])
    expect(r.map((m) => m.id)).toEqual(['a', 'b'])
    expect(r[0]!.timestamp).toBe(100_000)
  })

  it('исходящее: статус из statusMessage, по умолчанию sent', () => {
    const r = mapHistory([
      item({ idMessage: 'o1', type: 'outgoing', statusMessage: 'read' }),
      item({ idMessage: 'o2', type: 'outgoing', timestamp: 101 }),
    ])
    expect(r.map((m) => [m.direction, m.status])).toEqual([['out', 'read'], ['out', 'sent']])
  })

  it('не-текст → заглушка', () => {
    const [m] = mapHistory([item({ typeMessage: 'videoMessage', textMessage: undefined })])
    expect(m!.text).toBe('[видео]')
  })

  it('пропускает элементы без idMessage или chatId', () => {
    expect(mapHistory([item({ idMessage: '' }), item({ chatId: '' })])).toEqual([])
  })

  it('пропускает не-объекты в массиве, без исключений', () => {
    const r = mapHistory([null, 5, item({ idMessage: 'ok' })] as never)
    expect(r.map((m) => m.id)).toEqual(['ok'])
  })
})
