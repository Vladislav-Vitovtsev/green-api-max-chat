import { isAbortError } from '../api/errors'

export type LocksLike = Pick<LockManager, 'request'>

type LeaderOptions = {
  signal: AbortSignal
  onLeader(signal: AbortSignal): Promise<void>
  onFollower(): void
  locks?: LocksLike | null
}

const defaultLocks = (): LocksLike | null =>
  typeof navigator !== 'undefined' && 'locks' in navigator ? navigator.locks : null

export async function runAsLeader(name: string, opts: LeaderOptions): Promise<void> {
  const locks = opts.locks === undefined ? defaultLocks() : opts.locks
  if (!locks) {
    try {
      await opts.onLeader(opts.signal)
    } catch (e) {
      if (!isAbortError(e)) throw e
    }
    return
  }
  if (opts.signal.aborted) return

  try {
    const got = await locks.request(name, { ifAvailable: true }, async (lock) => {
      if (!lock) return false
      await opts.onLeader(opts.signal)
      return true
    })
    if (got || opts.signal.aborted) return
  } catch (e) {
    if (!isAbortError(e)) throw e
    return
  }

  opts.onFollower()
  try {
    await locks.request(name, { signal: opts.signal }, async () => {
      if (!opts.signal.aborted) await opts.onLeader(opts.signal)
    })
  } catch (e) {
    if (!isAbortError(e)) throw e
  }
}
