import { daysBetweenMidnights } from './format'

it('daysBetweenMidnights считает сутки одним днём независимо от их длины в часах', () => {
  expect(daysBetweenMidnights(0, 90_000_000)).toBe(1)
  expect(daysBetweenMidnights(0, 82_800_000)).toBe(1)
  expect(daysBetweenMidnights(0, 86_400_000)).toBe(1)
  expect(daysBetweenMidnights(0, 0)).toBe(0)
  expect(daysBetweenMidnights(0, 172_800_000 + 3_600_000)).toBe(2)
})
