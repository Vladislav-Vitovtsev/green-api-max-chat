import { formatPhone, formatPhoneInput, normalizePhone } from './phone'

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

  it('явный + не даёт эвристике 8→7/9→РФ проглотить чужой код страны подходящей длины', () => {
    // «90» — код Турции, 8 цифр номера = 10 всего, начинается с 9: без учёта явного +
    // это ошибочно приняло бы «9» за ярлык «РФ без кода страны».
    expect(normalizePhone('+90 1234 5678')).toEqual({ ok: false, error: 'country' })
    // «81» — код Японии, 9 цифр номера = 11 всего, начинается с 8: без учёта явного +
    // это ошибочно приняло бы «8» за ярлык «8 вместо 7».
    expect(normalizePhone('+81 123456789')).toEqual({ ok: false, error: 'country' })
  })
})

describe('formatPhone', () => {
  it('форматирует РФ и РБ', () => {
    expect(formatPhone('79991234567')).toBe('+7 999 123-45-67')
    expect(formatPhone('375291234567')).toBe('+375 29 123-45-67')
  })
})

describe('formatPhoneInput', () => {
  it('РФ — полный ввод с 8', () => {
    expect(formatPhoneInput('89991234567')).toBe('+7 999 123-45-67')
  })

  it('РФ — полный ввод с явным +7', () => {
    expect(formatPhoneInput('+79991234567')).toBe('+7 999 123-45-67')
  })

  it('РФ — ведущая 9 без кода страны', () => {
    expect(formatPhoneInput('9991234567')).toBe('+7 999 123-45-67')
  })

  it('РФ — частичный ввод', () => {
    expect(formatPhoneInput('7999')).toBe('+7 999')
    expect(formatPhoneInput('79991')).toBe('+7 999 1')
  })

  it('РБ — полный ввод', () => {
    expect(formatPhoneInput('+375291234567')).toBe('+375 29 123-45-67')
  })

  it('РБ — частичный ввод', () => {
    expect(formatPhoneInput('+3752')).toBe('+375 2')
  })

  it('удаление символов форматирует более короткий ввод', () => {
    expect(formatPhoneInput('79991234567')).toBe('+7 999 123-45-67')
    expect(formatPhoneInput('7999123456')).toBe('+7 999 123-45-6')
    expect(formatPhoneInput('799912345')).toBe('+7 999 123-45')
    expect(formatPhoneInput('79991234')).toBe('+7 999 123-4')
  })

  it('чужой код страны — без группировки, максимум 15 цифр', () => {
    expect(formatPhoneInput('+49 1512 3456789')).toBe('+4915123456789')
    expect(formatPhoneInput('123456789012345678')).toBe('+123456789012345')
  })

  it('чужой код страны с ведущими 8/9 — не путается с РФ, если явный +', () => {
    expect(formatPhoneInput('+86 138 1234 5678')).toBe('+8613812345678')
    expect(formatPhoneInput('+90 532 123 45 67')).toBe('+905321234567')
  })

  it('8→7 и 9→РФ работают только без явного + и в пределах длины РФ-номера', () => {
    expect(formatPhoneInput('89991234567')).toBe('+7 999 123-45-67')
    expect(formatPhoneInput('9991234567')).toBe('+7 999 123-45-67')
  })

  it('РФ — лишние цифры сверх 11 игнорируются', () => {
    expect(formatPhoneInput('799912345678')).toBe('+7 999 123-45-67')
  })

  it('РБ — лишние цифры сверх 12 игнорируются', () => {
    expect(formatPhoneInput('+3752912345678')).toBe('+375 29 123-45-67')
  })

  it('одинокий + сохраняется при вводе', () => {
    expect(formatPhoneInput('+')).toBe('+')
  })

  it('пустой ввод', () => {
    expect(formatPhoneInput('')).toBe('')
    expect(formatPhoneInput('   ')).toBe('')
  })
})
