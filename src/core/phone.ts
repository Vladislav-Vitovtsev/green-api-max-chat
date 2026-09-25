export type PhoneResult =
  | { ok: true; phone: string }
  | { ok: false; error: 'empty' | 'format' | 'country' }

export function normalizePhone(input: string): PhoneResult {
  const trimmed = input.trim()
  const digits = trimmed.replace(/\D/g, '')
  if (!trimmed) return { ok: false, error: 'empty' }
  if (!digits) return { ok: false, error: 'format' }

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
const RU_NATIONAL_MAX = 10
const BY_NATIONAL_MAX = 9
const GROUP_SEPS = [' ', '-', '-']
const OTHER_MAX_DIGITS = 15

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

function withCountryCode(code: string, national: string, groupSizes: number[], nationalMax: number): string {
  const grouped = groupDigits(national.slice(0, nationalMax), groupSizes)
  return grouped ? `+${code} ${grouped}` : `+${code}`
}

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
