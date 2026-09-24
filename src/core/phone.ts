export type PhoneResult =
  | { ok: true; phone: string }
  | { ok: false; error: 'empty' | 'format' | 'country' }

export function normalizePhone(input: string): PhoneResult {
  const digits = input.replace(/\D/g, '')
  if (!input.trim()) return { ok: false, error: 'empty' }
  if (!digits) return { ok: false, error: 'format' }

  let d = digits
  if (d.length === 11 && d.startsWith('8')) d = `7${d.slice(1)}`
  if (d.length === 10 && d.startsWith('9')) d = `7${d}`

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
