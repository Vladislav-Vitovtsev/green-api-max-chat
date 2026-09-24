import { avatarGradient, formatDay, formatTime, initials } from './format'

const now = new Date(2026, 8, 24, 12, 0).getTime()

it('formatTime', () => {
  expect(formatTime(new Date(2026, 8, 24, 9, 5).getTime(), now)).toBe('09:05')
  expect(formatTime(new Date(2026, 8, 23, 22, 0).getTime(), now)).toBe('Вчера')
  expect(formatTime(new Date(2026, 8, 17, 8, 0).getTime(), now)).toBe('17.09')
})
it('formatDay', () => {
  expect(formatDay(new Date(2026, 8, 24, 1).getTime(), now)).toBe('Сегодня')
  expect(formatDay(new Date(2026, 8, 23, 1).getTime(), now)).toBe('Вчера')
  expect(formatDay(new Date(2026, 8, 1, 1).getTime(), now)).toBe('1 сентября')
})
it('initials и градиент стабильны', () => {
  expect(initials('Тест Тестов')).toBe('ТТ')
  expect(initials('+7 999 123-45-67')).toBe('#')
  expect(avatarGradient('10000001')).toBe(avatarGradient('10000001'))
})
