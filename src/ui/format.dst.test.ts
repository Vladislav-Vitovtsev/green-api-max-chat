import { daysBetweenMidnights } from './format'

// На переходе летнего/зимнего времени сутки между двумя полночами могут длиться
// не 24 часа, а 23 (весна) или 25 (осень) — daysBetweenMidnights всё равно считает
// это одним днём. Чистая функция от чисел, TZ процесса не трогаем.
it('daysBetweenMidnights считает сутки одним днём независимо от их длины в часах', () => {
  expect(daysBetweenMidnights(0, 90_000_000)).toBe(1) // 25-часовые сутки
  expect(daysBetweenMidnights(0, 82_800_000)).toBe(1) // 23-часовые сутки
  expect(daysBetweenMidnights(0, 86_400_000)).toBe(1) // обычные сутки
  expect(daysBetweenMidnights(0, 0)).toBe(0)
  expect(daysBetweenMidnights(0, 172_800_000 + 3_600_000)).toBe(2) // двое суток, одни из них 25-часовые
})
