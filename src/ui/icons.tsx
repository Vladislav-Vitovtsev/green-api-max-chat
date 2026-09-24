import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>
const base = (p: P) => {
  const labelled = p['aria-label'] != null
  return {
    width: 24,
    height: 24,
    viewBox: '0 0 24 24',
    fill: 'none',
    ...(labelled ? { role: 'img' as const } : { 'aria-hidden': true as const }),
    ...p,
  }
}
const stroke = { stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export const IconPlus = (p: P) => (<svg {...base(p)}><path d="M12 5v14M5 12h14" {...stroke} /></svg>)
export const IconSend = (p: P) => (<svg {...base(p)}><path d="M4 12 20 4l-4 16-4-7-8-1Z" {...stroke} /></svg>)
export const IconBack = (p: P) => (<svg {...base(p)}><path d="M15 5 8 12l7 7" {...stroke} /></svg>)
export const IconLogout = (p: P) => (<svg {...base(p)}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4" {...stroke} /></svg>)
export const IconChats = (p: P) => (<svg {...base(p)}><path d="M4 5h16v11H9l-5 4V5Z" {...stroke} /></svg>)
export const IconCheck = (p: P) => (<svg {...base({ width: 16, height: 16, viewBox: '0 0 16 16', ...p })}><path d="m3 8.5 3 3 7-7" {...stroke} strokeWidth={1.6} /></svg>)
export const IconDoubleCheck = (p: P) => (<svg {...base({ width: 18, height: 16, viewBox: '0 0 18 16', ...p })}><path d="m1 8.5 3 3 7-7M7 11.5l1 0 7-7" {...stroke} strokeWidth={1.6} /></svg>)
export const IconClock = (p: P) => (<svg {...base({ width: 14, height: 14, viewBox: '0 0 16 16', ...p })}><circle cx="8" cy="8" r="6" {...stroke} strokeWidth={1.6} /><path d="M8 5v3l2 1.5" {...stroke} strokeWidth={1.6} /></svg>)
export const IconAlert = (p: P) => (<svg {...base({ width: 16, height: 16, viewBox: '0 0 16 16', ...p })}><circle cx="8" cy="8" r="7" fill="currentColor" /><path d="M8 4.5v4.2M8 11.2v.3" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" /></svg>)
export const IconEye = (p: P) => (<svg {...base(p)}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" {...stroke} /><circle cx="12" cy="12" r="3" {...stroke} /></svg>)
export const IconEyeOff = (p: P) => (<svg {...base(p)}><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 4.4-1" {...stroke} /></svg>)
