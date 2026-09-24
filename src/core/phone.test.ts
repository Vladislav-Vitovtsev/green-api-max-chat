import { formatPhone, normalizePhone } from './phone'

describe('normalizePhone', () => {
  it.each([
    ['+7 (999) 123-45-67', '79991234567'],
    ['8 999 123 45 67', '79991234567'],
    ['79991234567', '79991234567'],
    ['9991234567', '79991234567'],
    ['+375 29 123-45-67', '375291234567'],
  ])('%s → %s', (input, phone) => {
    expect(normalizePhone(input)).toEqual({ ok: true, phone })
  })

  it('пустой ввод', () => {
    expect(normalizePhone('  ')).toEqual({ ok: false, error: 'empty' })
  })

  it('чужая страна правильной длины → country', () => {
    expect(normalizePhone('+382 67 123 456')).toEqual({ ok: false, error: 'country' })
    expect(normalizePhone('+49 1512 3456789')).toEqual({ ok: false, error: 'country' })
  })

  it('мусор → format', () => {
    expect(normalizePhone('12345')).toEqual({ ok: false, error: 'format' })
    expect(normalizePhone('abc')).toEqual({ ok: false, error: 'format' })
  })

  it('РФ/РБ с неверным количеством цифр → format, не country', () => {
    expect(normalizePhone('+7 999 123-45-678')).toEqual({ ok: false, error: 'format' })
    expect(normalizePhone('+375 29 123-45-6')).toEqual({ ok: false, error: 'format' })
  })
})

describe('formatPhone', () => {
  it('форматирует РФ и РБ', () => {
    expect(formatPhone('79991234567')).toBe('+7 999 123-45-67')
    expect(formatPhone('375291234567')).toBe('+375 29 123-45-67')
  })
})
