export type LocksLike = Pick<LockManager, 'request'>

export const ACTIVE_TAB_LOCK = 'max-chat:active-tab'

// Сколько ждать лок при старте. Сразу после F5 лок ещё может держать выгружающийся старый
// документ той же вкладки: ifAvailable в этот миг ответил бы «занято», и единственная
// вкладка показала бы экран блокировки. Ожидание с таймаутом переживает эту гонку.
export const ACTIVE_TAB_WAIT_MS = 1000

type Options = {
  // undefined: navigator.locks, если есть; null: Web Locks недоступны (вкладка всегда активна).
  locks?: LocksLike | null
  waitMs?: number
  onActive(): void
  onBlocked(): void
  onLost(): void
}

export type ActiveTab = {
  // Забрать лок у вкладки, которая его держит (steal). Её request отклоняется, и она зовёт onLost.
  // Промис завершается, когда перехват удался или не удался.
  takeOver(): Promise<void>
}

const defaultLocks = (): LocksLike | null =>
  typeof navigator !== 'undefined' && 'locks' in navigator ? navigator.locks : null

// Работает одна активная вкладка: она держит эксклюзивный Web Lock, пока жива.
// Лок получен за waitMs → onActive; не получен → onBlocked, дальше решает пользователь (takeOver).
// Лок отпускается при закрытии вкладки (браузер снимает его сам) или когда его забирают.
export function acquireActiveTab(opts: Options): ActiveTab {
  const locks = opts.locks === undefined ? defaultLocks() : opts.locks
  if (!locks) {
    opts.onActive()
    return { takeOver: async () => {} }
  }

  let holding = false
  let stealing = false

  // Промис завершается, когда стало ясно, получен ли лок этим запросом.
  const hold = (options: LockOptions, onFail: () => void) =>
    new Promise<void>((settled) => {
      let granted = false
      locks
        .request(ACTIVE_TAB_LOCK, options, () => {
          granted = true
          holding = true
          opts.onActive()
          settled()
          // Держим лок, пока вкладка жива: этот промис не завершается никогда.
          return new Promise<never>(() => {})
        })
        .catch(() => {
          // Держатель, у которого лок забрали через steal, получает отказ (AbortError).
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
    // Таймаут: лок держит другая вкладка. Любой другой отказ до получения лока
    // (например, SecurityError) значит, что Web Locks тут не работают: ведём себя как без них.
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
