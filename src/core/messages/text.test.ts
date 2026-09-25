import type { Message } from '../model'
import { captionOf } from './text'

const msg = (over: Partial<Message> = {}): Message => ({
  id: 'a', chatId: 'c', direction: 'in', text: '', timestamp: 100, status: 'sent', ...over,
})

describe('captionOf', () => {
  it('без mediaLabel — возвращает text как есть', () => {
    expect(captionOf(msg({ text: 'привет' }))).toBe('привет')
  })

  it('text отличается от mediaLabel — это подпись, возвращается как есть', () => {
    expect(captionOf(msg({ text: 'Отпуск', mediaLabel: '📷 Фото' }))).toBe('Отпуск')
  })

  it('text совпадает с mediaLabel (устаревшие данные) — подписи нет, пустая строка', () => {
    expect(captionOf(msg({ text: '📷 Фото', mediaLabel: '📷 Фото' }))).toBe('')
  })

  it('mediaLabel есть, text пустой — пустая строка', () => {
    expect(captionOf(msg({ text: '', mediaLabel: '🎥 Видео' }))).toBe('')
  })
})
