import { runAsLeader, type LocksLike } from './leader'

function fakeLocks(): LocksLike {
  const held = new Set<string>()
  const waiters = new Map<string, { resolve: () => void }[]>()
  const release = (name: string) => {
    const list = waiters.get(name)
    const next = list?.shift()
    if (next) {
      next.resolve()
      return
    }
    held.delete(name)
  }
  const request = (async (name: string, a: unknown, b?: unknown) => {
    const opts = (typeof a === 'function' ? {} : a) as { ifAvailable?: boolean; signal?: AbortSignal }
    const cb = (typeof a === 'function' ? a : b) as (lock: unknown) => Promise<unknown>
    if (held.has(name)) {
      if (opts.ifAvailable) return cb(null)
      if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      await new Promise<void>((resolve, reject) => {
        const entry = { resolve }
        const list = waiters.get(name) ?? []
        list.push(entry)
        waiters.set(name, list)
        opts.signal?.addEventListener('abort', () => {
          const l = waiters.get(name)
          const idx = l?.indexOf(entry) ?? -1
          if (idx >= 0) l!.splice(idx, 1)
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
      // Лок передан напрямую в release(): он остаётся held, повторно добавлять не нужно.
    } else {
      held.add(name)
    }
    try {
      return await cb({ name })
    } finally {
      release(name)
    }
  }) as unknown as LocksLike['request']
  return { request }
}

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

describe('runAsLeader', () => {
  it('первая вкладка — лидер, вторая — ведомая и становится лидером после первой', async () => {
    const locks = fakeLocks()
    const first = deferred()
    const log: string[] = []

    const tab1 = runAsLeader('L', {
      signal: new AbortController().signal,
      locks,
      onLeader: async () => {
        log.push('1:leader')
        await first.promise
      },
      onFollower: () => log.push('1:follower'),
    })
    const tab2 = runAsLeader('L', {
      signal: new AbortController().signal,
      locks,
      onLeader: async () => {
        log.push('2:leader')
      },
      onFollower: () => log.push('2:follower'),
    })

    await vi.waitFor(() => expect(log).toEqual(['1:leader', '2:follower']))
    first.resolve()
    await Promise.all([tab1, tab2])
    expect(log).toEqual(['1:leader', '2:follower', '2:leader'])
  })

  it('ведомая вкладка выходит без ошибки при abort', async () => {
    const locks = fakeLocks()
    const hold = deferred()
    void runAsLeader('L', { signal: new AbortController().signal, locks, onLeader: () => hold.promise, onFollower: () => {} })
    const c = new AbortController()
    const onLeader = vi.fn(async () => {})
    const onFollower = vi.fn()
    const p = runAsLeader('L', { signal: c.signal, locks, onLeader, onFollower })
    await vi.waitFor(() => expect(onFollower).toHaveBeenCalled())
    c.abort()
    await expect(p).resolves.toBeUndefined()
    expect(onLeader).not.toHaveBeenCalled()
    hold.resolve()
  })

  it('без Web Locks сразу лидер', async () => {
    const onLeader = vi.fn(async () => {})
    await runAsLeader('L', { signal: new AbortController().signal, locks: null, onLeader, onFollower: () => {} })
    expect(onLeader).toHaveBeenCalledOnce()
  })

  it('третья вкладка в очереди получает лидерство, если вторая (перед ней) прервана abort', async () => {
    const locks = fakeLocks()
    const holdA = deferred()
    const log: string[] = []

    const tabA = runAsLeader('L', {
      signal: new AbortController().signal,
      locks,
      onLeader: async () => {
        log.push('A:leader')
        await holdA.promise
      },
      onFollower: () => log.push('A:follower'),
    })
    const cB = new AbortController()
    const onLeaderB = vi.fn(async () => {})
    const tabB = runAsLeader('L', { signal: cB.signal, locks, onLeader: onLeaderB, onFollower: () => log.push('B:follower') })
    const tabC = runAsLeader('L', {
      signal: new AbortController().signal,
      locks,
      onLeader: async () => {
        log.push('C:leader')
      },
      onFollower: () => log.push('C:follower'),
    })

    await vi.waitFor(() => expect(log).toEqual(['A:leader', 'B:follower', 'C:follower']))
    cB.abort()
    await tabB
    expect(onLeaderB).not.toHaveBeenCalled()

    holdA.resolve()
    await Promise.all([tabA, tabC])
    expect(log).toEqual(['A:leader', 'B:follower', 'C:follower', 'C:leader'])
  })

  it('если onLeader выбрасывает ошибку — runAsLeader падает с ней, а следующая вкладка в очереди становится лидером', async () => {
    const locks = fakeLocks()
    const holdA = deferred()
    const log: string[] = []
    const err = new Error('boom')

    const tabA = runAsLeader('L', {
      signal: new AbortController().signal,
      locks,
      onLeader: async () => {
        log.push('A:leader')
        await holdA.promise
      },
      onFollower: () => log.push('A:follower'),
    })
    const tabB = runAsLeader('L', {
      signal: new AbortController().signal,
      locks,
      onLeader: async () => {
        throw err
      },
      onFollower: () => log.push('B:follower'),
    })
    const tabC = runAsLeader('L', {
      signal: new AbortController().signal,
      locks,
      onLeader: async () => {
        log.push('C:leader')
      },
      onFollower: () => log.push('C:follower'),
    })

    await vi.waitFor(() => expect(log).toEqual(['A:leader', 'B:follower', 'C:follower']))
    holdA.resolve()
    await expect(tabB).rejects.toBe(err)
    await Promise.all([tabA, tabC])
    expect(log).toEqual(['A:leader', 'B:follower', 'C:follower', 'C:leader'])
  })

  it('уже прерванный signal до вызова — ни onLeader, ни onFollower не вызываются', async () => {
    const locks = fakeLocks()
    const c = new AbortController()
    c.abort()
    const onLeader = vi.fn(async () => {})
    const onFollower = vi.fn()
    await runAsLeader('L', { signal: c.signal, locks, onLeader, onFollower })
    expect(onLeader).not.toHaveBeenCalled()
    expect(onFollower).not.toHaveBeenCalled()
  })

  it('AbortError из onLeader на пути немедленного лидерства гасится — runAsLeader резолвится', async () => {
    const locks = fakeLocks()
    const onLeader = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError')
    })
    await expect(
      runAsLeader('L', { signal: new AbortController().signal, locks, onLeader, onFollower: () => {} }),
    ).resolves.toBeUndefined()
  })

  it('AbortError из onLeader без Web Locks тоже гасится — runAsLeader резолвится', async () => {
    const onLeader = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError')
    })
    await expect(
      runAsLeader('L', { signal: new AbortController().signal, locks: null, onLeader, onFollower: () => {} }),
    ).resolves.toBeUndefined()
  })
})
