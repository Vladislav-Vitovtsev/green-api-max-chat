export type PhoneResult =
  | { ok: true; phone: string }
  | { ok: false; error: 'empty' | 'format' | 'country' }

export function normalizePhone(input: string): PhoneResult {
  const trimmed = input.trim()
  const digits = trimmed.replace(/\D/g, '')
  if (!trimmed) return { ok: false, error: 'empty' }
  if (!digits) return { ok: false, error: 'format' }

  // Как и в formatPhoneInput: «8» и «9» — ярлыки только для локального ввода без кода
  // страны. Если пользователь явно набрал «+», это первая цифра настоящего кода страны
  // (+81 Япония, +90 Турция и т.п.), а не сокращение для РФ — эвристику не применяем,
  // иначе чужой номер подходящей длины молча принимается за российский.
  const explicitPlus = trimmed.startsWith('+')
  let d = digits
  if (!explicitPlus && d.length === 11 && d.startsWith('8')) d = `7${d.slice(1)}`
  if (!explicitPlus && d.length === 10 && d.startsWith('9')) d = `7${d}`

  if (d.length === 11 && d.startsWith('7')) return { ok: true, phone: d }
  if (d.length === 12 && d.startsWith('375')) return { ok: true, phone: d }
  if (d.startsWith('375') || d.startsWith('7')) return { ok: false, error: 'format' }
  if (d.length >= 10 && d.length <= 13) return { ok: false, error: 'country' }
  return { ok: false, error: 'format' }
}

export function formatPhone(phone: string): string {
  if (phone.length === 11 && phone.startsWith('7')) {
    return `+7 ${phone.slice(1, 4)} ${phone.slice(4, 7)}-${phone.slice(7, 9)}-${phone.slice(9)}`
  }
  if (phone.length === 12 && phone.startsWith('375')) {
    return `+375 ${phone.slice(3, 5)} ${phone.slice(5, 8)}-${phone.slice(8, 10)}-${phone.slice(10)}`
  }
  return `+${phone}`
}

const RU_GROUPS = [3, 3, 2, 2]
const BY_GROUPS = [2, 3, 2, 2]
const RU_NATIONAL_MAX = 10 // сумма RU_GROUPS — код страны «7» + 10 цифр номера = 11 всего
const BY_NATIONAL_MAX = 9 // сумма BY_GROUPS — код страны «375» + 9 цифр номера = 12 всего
const GROUP_SEPS = [' ', '-', '-']
const OTHER_MAX_DIGITS = 15

// Группирует национальный номер по маске (например [3,3,2,2]), разделяя группы GROUP_SEPS.
// national уже обрезан до нужной длины вызывающим кодом — цифр сверх маски здесь не бывает.
function groupDigits(national: string, groupSizes: number[]): string {
  let result = ''
  let idx = 0
  for (let i = 0; i < groupSizes.length; i++) {
    if (idx >= national.length) break
    const size = groupSizes[i]!
    if (i > 0) result += GROUP_SEPS[i - 1]
    result += national.slice(idx, idx + size)
    idx += size
  }
  return result
}

// national обрезается до nationalMax — цифры сверх маски РФ/РБ отбрасываются, а не дописываются.
function withCountryCode(code: string, national: string, groupSizes: number[], nationalMax: number): string {
  const grouped = groupDigits(national.slice(0, nationalMax), groupSizes)
  return grouped ? `+${code} ${grouped}` : `+${code}`
}

// Форматирует ввод по мере набора теми же правилами, что normalizePhone (8→7 для РФ,
// ведущая 9 → РФ без кода страны), но без валидации длины — партиальный ввод форматируется
// частично. Курсор не отслеживается: значение переформатируется целиком при каждом onChange.
//
// Ярлыки «8→7» и «9→РФ» — эвристика для локального набора без кода страны и применяются
// только пока введённых цифр не больше длины полного РФ-номера (иначе это, скорее всего,
// чужой код страны вроде +86…/+90…, а не затянувшийся ввод РФ). Если ввод начинается с «+»,
// пользователь явно указывает код страны — тогда «8» и «9» не ярлыки, а первая цифра
// настоящего кода страны (+86 Китай, +90 Турция и т.п.), и ярлыки не применяются вовсе.
export function formatPhoneInput(raw: string): string {
  const trimmed = raw.trim()
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return trimmed.startsWith('+') ? '+' : ''

  const explicitPlus = trimmed.startsWith('+')
  if (digits.startsWith('375')) return withCountryCode('375', digits.slice(3), BY_GROUPS, BY_NATIONAL_MAX)
  if (digits.startsWith('7')) return withCountryCode('7', digits.slice(1), RU_GROUPS, RU_NATIONAL_MAX)
  if (!explicitPlus && digits.startsWith('8') && digits.length <= 11) {
    return withCountryCode('7', digits.slice(1), RU_GROUPS, RU_NATIONAL_MAX)
  }
  if (!explicitPlus && digits.startsWith('9') && digits.length <= 10) {
    return withCountryCode('7', digits, RU_GROUPS, RU_NATIONAL_MAX)
  }
  return `+${digits.slice(0, OTHER_MAX_DIGITS)}`
}
