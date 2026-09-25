import type { RawNotification } from '../api/types'
import { ApiError } from '../api/errors'
import { fixtures } from './__fixtures__/notifications'
import type { DomainEvent } from './model'
import { createPoller, type PollerStatus } from './poller'

type Step = RawNotification | null | Error

function setup(steps: Step[], opts: { onEvent?: (ev: DomainEvent) => void; ackFails?: boolean } = {}) {
  const stop = new AbortController()
  const events: DomainEvent[] = []
  const acks: number[] = []
  const statuses: PollerStatus[] = []
  const sleeps: number[] = []
  const fatal: ApiError[] = []
  let clock = 0
  const poller = createPoller({
    receive: async () => {
      const step = steps.shift()
      if (step === undefined) {
        stop.abort()
        throw new DOMException('stop', 'AbortError')
      }
      if (step instanceof Error) throw step
      return step
    },
    ack: async (id) => {
      acks.push(id)
      if (opts.ackFails) throw new ApiError('network')
    },
    onEvent: opts.onEvent ?? ((ev) => events.push(ev)),
    onStatus: (s) => statuses.push(s),
    onFatal: (e) => {
      fatal.push(e)
    },
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    now: () => {
      clock += 2000
      return clock
    },
    random: () => 1,
  })
  return { stop, poller, events, acks, statuses, sleeps, fatal }
}

const n = (receiptId: number, body: Record<string, unknown>): RawNotification => ({ receiptId, body })

describe('poller', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('обрабатывает и подтверждает уведомления по порядку', async () => {
    const t = setup([n(1, fixtures.incomingText), null, n(2, fixtures.statusDelivered)])
    await t.poller.run(t.stop.signal)
    expect(t.events.map((e) => e.type)).toEqual(['message', 'status'])
    expect(t.acks).toEqual([1, 2])
    expect(t.statuses).toContain('polling')
  })

  it('подтверждает даже нераспознанное уведомление', async () => {
    const t = setup([n(7, { typeWebhook: 'deviceInfo' })])
    await t.poller.run(t.stop.signal)
    expect(t.events).toEqual([])
    expect(t.acks).toEqual([7])
  })

  it('подтверждает, даже если обработчик события упал; в лог идёт категория ошибки, а не сырой текст', async () => {
    const t = setup([n(3, fixtures.incomingText)], {
      onEvent: () => {
        throw new Error('текст сообщения, который не должен попасть в лог')
      },
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await t.poller.run(t.stop.signal)
    expect(t.acks).toEqual([3])
    expect(warn).toHaveBeenCalledWith('[poller] обработчик уведомления упал', 'unknown')
  })

  it('receive резолвится успешно ровно в момент stop.abort() — уведомление не обрабатывается и не ack\'ается', async () => {
    const stop = new AbortController()
    const events: DomainEvent[] = []
    const acks: number[] = []
    const poller = createPoller({
      receive: async () => {
        stop.abort()
        return n(9, fixtures.incomingText)
      },
      ack: async (id) => {
        acks.push(id)
      },
      onEvent: (ev) => events.push(ev),
      onStatus: () => {},
      onFatal: () => {},
    })
    await poller.run(stop.signal)
    expect(events).toEqual([])
    expect(acks).toEqual([])
  })

  it('сеть и 429 → бэкофф с ростом, затем сброс после успеха', async () => {
    const t = setup([new ApiError('network'), new ApiError('rateLimit'), null, new ApiError('network')])
    await t.poller.run(t.stop.signal)
    expect(t.sleeps).toEqual([1000, 2000, 1000])
    expect(t.statuses).toEqual(['offline', 'error', 'polling', 'offline'])
  })

  it('401 → onFatal и выход из цикла', async () => {
    const t = setup([new ApiError('unauthorized'), n(1, fixtures.incomingText)])
    await t.poller.run(t.stop.signal)
    expect(t.fatal.map((e) => e.kind)).toEqual(['unauthorized'])
    expect(t.events).toEqual([])
  })

  it('ошибка ack → бэкофф, цикл продолжается', async () => {
    const t = setup([n(1, fixtures.incomingText), null], { ackFails: true })
    await t.poller.run(t.stop.signal)
    expect(t.sleeps.length).toBe(1)
    expect(t.events.length).toBe(1)
  })

  it('выходит сразу, если stop уже прерван', async () => {
    const t = setup([n(1, fixtures.incomingText)])
    t.stop.abort()
    await t.poller.run(t.stop.signal)
    expect(t.acks).toEqual([])
  })
})

describe('poller — устойчивость (fix round 1)', () => {
  it('ack постоянно падает на одном receiptId → бэкофф растёт, onEvent — один раз', async () => {
    const stop = new AbortController()
    const events: DomainEvent[] = []
    const sleeps: number[] = []
    let receiveCalls = 0
    const poller = createPoller({
      receive: async () => {
        receiveCalls++
        if (receiveCalls > 4) {
          stop.abort()
          throw new DOMException('stop', 'AbortError')
        }
        return n(9, fixtures.incomingText)
      },
      ack: async () => {
        throw new ApiError('rateLimit')
      },
      onEvent: (ev) => events.push(ev),
      onStatus: () => {},
      onFatal: () => {},
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      random: () => 1,
    })
    await poller.run(stop.signal)
    expect(sleeps).toEqual([1000, 2000, 4000, 8000])
    expect(events.length).toBe(1)
  })

  it('пустой ответ раньше MIN_EMPTY_POLL_MS → досыпает до минимального интервала', async () => {
    const stop = new AbortController()
    const sleeps: number[] = []
    let calls = 0
    const clock = 0
    const poller = createPoller({
      receive: async () => {
        calls++
        if (calls > 1) {
          stop.abort()
          throw new DOMException('stop', 'AbortError')
        }
        return null
      },
      ack: async () => {},
      onEvent: () => {},
      onStatus: () => {},
      onFatal: () => {},
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      now: () => clock,
      random: () => 1,
    })
    await poller.run(stop.signal)
    expect(sleeps).toEqual([1000])
  })

  it('пустой ответ после долгого опроса не досыпает', async () => {
    const stop = new AbortController()
    const sleeps: number[] = []
    let calls = 0
    let clock = 0
    const poller = createPoller({
      receive: async () => {
        calls++
        if (calls > 1) {
          stop.abort()
          throw new DOMException('stop', 'AbortError')
        }
        clock += 20_000
        return null
      },
      ack: async () => {},
      onEvent: () => {},
      onStatus: () => {},
      onFatal: () => {},
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      now: () => clock,
      random: () => 1,
    })
    await poller.run(stop.signal)
    expect(sleeps).toEqual([])
  })

  it('wake() во время receive() не теряется — следующая пауза пропускается', async () => {
    const stop = new AbortController()
    const sleeps: number[] = []
    let calls = 0
    const poller: ReturnType<typeof createPoller> = createPoller({
      receive: async () => {
        calls++
        if (calls === 1) {
          poller.wake()
          throw new ApiError('network')
        }
        stop.abort()
        throw new DOMException('stop', 'AbortError')
      },
      ack: async () => {},
      onEvent: () => {},
      onStatus: () => {},
      onFatal: () => {},
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      random: () => 1,
    })
    await poller.run(stop.signal)
    expect(sleeps).toEqual([])
  })

  it('AbortError из receive без stop.aborted трактуется как network (offline + бэкофф)', async () => {
    const stop = new AbortController()
    const statuses: PollerStatus[] = []
    const sleeps: number[] = []
    let calls = 0
    const poller = createPoller({
      receive: async () => {
        calls++
        if (calls === 1) throw new DOMException('unrelated', 'AbortError')
        stop.abort()
        throw new DOMException('stop', 'AbortError')
      },
      ack: async () => {},
      onEvent: () => {},
      onStatus: (s) => statuses.push(s),
      onFatal: () => {},
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      random: () => 1,
    })
    await poller.run(stop.signal)
    expect(statuses).toEqual(['offline'])
    expect(sleeps).toEqual([1000])
  })

  it('AbortError из ack без stop.aborted трактуется как network (offline + бэкофф)', async () => {
    const stop = new AbortController()
    const statuses: PollerStatus[] = []
    const sleeps: number[] = []
    let ackCalls = 0
    const poller = createPoller({
      receive: async () => {
        if (ackCalls > 0) {
          stop.abort()
          throw new DOMException('stop', 'AbortError')
        }
        return n(1, fixtures.incomingText)
      },
      ack: async () => {
        ackCalls++
        throw new DOMException('unrelated', 'AbortError')
      },
      onEvent: () => {},
      onStatus: (s) => statuses.push(s),
      onFatal: () => {},
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      random: () => 1,
    })
    await poller.run(stop.signal)
    expect(statuses).toEqual(['polling', 'offline'])
    expect(sleeps).toEqual([1000])
  })
})

describe('poller — реальный sleep', () => {
  it('wake() прерывает бэкофф-паузу раньше срока', async () => {
    const stop = new AbortController()
    const timestamps: number[] = []
    let calls = 0
    const poller = createPoller({
      receive: async () => {
        calls++
        timestamps.push(Date.now())
        if (calls === 1) throw new ApiError('network')
        stop.abort()
        throw new DOMException('stop', 'AbortError')
      },
      ack: async () => {},
      onEvent: () => {},
      onStatus: () => {},
      onFatal: () => {},
      random: () => 1,
    })
    const done = poller.run(stop.signal)
    await new Promise((resolve) => setTimeout(resolve, 30))
    poller.wake()
    await done
    expect(timestamps.length).toBe(2)
    expect(timestamps[1]! - timestamps[0]!).toBeLessThan(300)
  })

  it('stop.abort() во время бэкоффа завершает run() без исключения', async () => {
    const stop = new AbortController()
    const poller = createPoller({
      receive: async () => {
        throw new ApiError('network')
      },
      ack: async () => {},
      onEvent: () => {},
      onStatus: () => {},
      onFatal: () => {},
      random: () => 1,
    })
    const done = poller.run(stop.signal)
    await new Promise((resolve) => setTimeout(resolve, 30))
    const before = Date.now()
    stop.abort()
    await expect(done).resolves.toBeUndefined()
    expect(Date.now() - before).toBeLessThan(300)
  })

  it.each(['quota', 'validation', 'unknown'] as const)(
    '%s → error и бэкофф, не fatal, цикл продолжается',
    async (kind) => {
      const stop = new AbortController()
      const statuses: PollerStatus[] = []
      const fatal: ApiError[] = []
      let calls = 0
      const poller = createPoller({
        receive: async () => {
          calls++
          if (calls === 1) throw new ApiError(kind)
          stop.abort()
          throw new DOMException('stop', 'AbortError')
        },
        ack: async () => {},
        onEvent: () => {},
        onStatus: (s) => statuses.push(s),
        onFatal: (e) => fatal.push(e),
        random: () => 0,
      })
      await poller.run(stop.signal)
      expect(statuses).toEqual(['error'])
      expect(fatal).toEqual([])
      expect(calls).toBe(2)
    },
  )
})
