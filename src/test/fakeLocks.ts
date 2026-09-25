import type { LocksLike } from '../core/tabLock'

type Waiter = { grant: () => void }
type Holder = { reject: (e: unknown) => void; token: object }

export function fakeLocks(): LocksLike {
  const held = new Map<string, Holder>()
  const queues = new Map<string, Waiter[]>()

  const release = (name: string, token: object) => {
    if (held.get(name)?.token !== token) return
    held.delete(name)
    queues.get(name)?.shift()?.grant()
  }

  const run = (name: string, cb: (lock: Lock | null) => unknown) =>
    new Promise((resolve, reject) => {
      const token = {}
      held.set(name, { reject, token })
      Promise.resolve(cb({ name, mode: 'exclusive' } as Lock)).then(
        (v) => {
          release(name, token)
          resolve(v)
        },
        (e: unknown) => {
          release(name, token)
          reject(e)
        },
      )
    })

  const request = (async (name: string, opts: LockOptions, cb: (lock: Lock | null) => unknown) => {
    const current = held.get(name)
    if (current && opts.ifAvailable) return cb(null)
    if (current && opts.steal) {
      held.delete(name)
      current.reject(new DOMException('stolen', 'AbortError'))
    } else if (current) {
      if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      await new Promise<void>((grant, reject) => {
        const waiter = { grant }
        const queue = queues.get(name) ?? []
        queue.push(waiter)
        queues.set(name, queue)
        opts.signal?.addEventListener('abort', () => {
          const i = queue.indexOf(waiter)
          if (i < 0) return
          queue.splice(i, 1)
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    }
    return run(name, cb)
  }) as unknown as LocksLike['request']
  return { request }
}
