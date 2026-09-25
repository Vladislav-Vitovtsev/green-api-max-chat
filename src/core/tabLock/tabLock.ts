export type LocksLike = Pick<LockManager, 'request'>

export const ACTIVE_TAB_LOCK = 'max-chat:active-tab'

export const ACTIVE_TAB_WAIT_MS = 1000

type Options = {
  locks?: LocksLike | null
  waitMs?: number
  onActive(): void
  onBlocked(): void
  onLost(): void
}

export type ActiveTab = {
  takeOver(): Promise<void>
}

const defaultLocks = (): LocksLike | null =>
  typeof navigator !== 'undefined' && 'locks' in navigator ? navigator.locks : null

export function acquireActiveTab(opts: Options): ActiveTab {
  const locks = opts.locks === undefined ? defaultLocks() : opts.locks
  if (!locks) {
    opts.onActive()
    return { takeOver: async () => {} }
  }

  let holding = false
  let stealing = false

  const hold = (options: LockOptions, onFail: () => void) =>
    new Promise<void>((settled) => {
      let granted = false
      locks
        .request(ACTIVE_TAB_LOCK, options, () => {
          granted = true
          holding = true
          opts.onActive()
          settled()
          return new Promise<never>(() => {})
        })
        .catch(() => {
          if (granted) {
            holding = false
            opts.onLost()
          } else {
            onFail()
          }
          settled()
        })
    })

  const wait = new AbortController()
  const timer = setTimeout(() => wait.abort(), opts.waitMs ?? ACTIVE_TAB_WAIT_MS)
  void hold({ mode: 'exclusive', signal: wait.signal }, () => {
    if (wait.signal.aborted) opts.onBlocked()
    else opts.onActive()
  }).finally(() => clearTimeout(timer))

  return {
    async takeOver() {
      if (holding || stealing) return
      stealing = true
      await hold({ mode: 'exclusive', steal: true }, () => opts.onBlocked())
      stealing = false
    },
  }
}
