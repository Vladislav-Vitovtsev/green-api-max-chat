import type { AvatarTextGradient } from '@maxhub/max-ui'
import { texts } from './texts'

const startOfDay = (ts: number) => {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
const DAY = 86_400_000

export function daysBetweenMidnights(fromMidnightMs: number, toMidnightMs: number): number {
  return Math.round((toMidnightMs - fromMidnightMs) / DAY)
}

export function dayDiff(ts: number, now: number): number {
  return daysBetweenMidnights(startOfDay(ts), startOfDay(now))
}

export function formatTime(ts: number, now = Date.now()): string {
  const days = dayDiff(ts, now)
  if (days <= 0) return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  if (days === 1) return texts.chat.yesterday
  return new Date(ts).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

export function formatDay(ts: number, now = Date.now()): string {
  const days = dayDiff(ts, now)
  if (days <= 0) return texts.chat.today
  if (days === 1) return texts.chat.yesterday
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

export function initials(title: string): string {
  if (title.startsWith('+')) return '#'
  return title.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '#'
}

const GRADIENTS: AvatarTextGradient[] = ['red', 'orange', 'green', 'blue', 'purple']
export function avatarGradient(chatId: string): AvatarTextGradient {
  let h = 0
  for (const ch of chatId) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return GRADIENTS[h % GRADIENTS.length]!
}
