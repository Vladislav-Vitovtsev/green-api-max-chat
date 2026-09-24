import { ApiError, isAbortError, toApiError } from '../api/errors'
import type { RawNotification } from '../api/types'
import { backoffDelay, sleep as realSleep } from './backoff'
import type { DomainEvent } from './model'
import { parseNotification } from './notifications'

export type PollerStatus = 'polling' | 'offline' | 'error'

export type PollerDeps = {
  receive(signal: AbortSignal): Promise<RawNotification | null>
  ack(receiptId: number, signal: AbortSignal): Promise<void>
  onEvent(ev: DomainEvent): void
  onStatus(s: PollerStatus): void
  onFatal(err: ApiError): void
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  random?: () => number
  now?: () => number
}

/** Не долбим receive() чаще раза в секунду, даже если сервер отвечает пустым результатом мгновенно. */
const MIN_EMPTY_POLL_MS = 1000

export function createPoller(deps: PollerDeps) {
  const sleep = deps.sleep ?? realSleep
  const now = deps.now ?? Date.now
  let wakeController = new AbortController()
  let wakePending = false
  let attempt = 0
  let lastStatus: PollerStatus | null = null
  let lastUnackedReceiptId: number | null = null

  const setStatus = (s: PollerStatus) => {
    if (s !== lastStatus) {
      lastStatus = s
      deps.onStatus(s)
    }
  }

  async function interruptibleSleep(ms: number, stop: AbortSignal): Promise<void> {
    if (wakePending) {
      wakePending = false
      return
    }
    wakeController = new AbortController()
    try {
      await sleep(ms, AbortSignal.any([stop, wakeController.signal]))
    } finally {
      wakePending = false
    }
  }

  async function pause(stop: AbortSignal) {
    attempt++
    await interruptibleSleep(backoffDelay(attempt, deps.random), stop)
  }

  async function run(stop: AbortSignal): Promise<void> {
    while (!stop.aborted) {
      const t0 = now()
      let n: RawNotification | null
      try {
        n = await deps.receive(stop)
      } catch (e) {
        if (stop.aborted) return
        if (isAbortError(e)) {
          // stop не прерван — это не наш abort, а сетевой обрыв соединения.
          setStatus('offline')
          await pause(stop)
          continue
        }
        const err = toApiError(e)
        if (err.kind === 'unauthorized') {
          deps.onFatal(err)
          return
        }
        setStatus(err.kind === 'network' ? 'offline' : 'error')
        await pause(stop)
        continue
      }

      setStatus('polling')

      if (!n) {
        attempt = 0
        const elapsed = now() - t0
        const remaining = MIN_EMPTY_POLL_MS - elapsed
        if (remaining > 0) {
          await interruptibleSleep(remaining, stop)
        }
        continue
      }

      // Уведомление ещё не подтверждено с прошлого цикла — сервер вернул его же снова.
      // Обработчик уже отработал, повторно эмитить событие не нужно, только повторяем ack.
      const isRetry = lastUnackedReceiptId === n.receiptId
      if (!isRetry) {
        try {
          const ev = parseNotification(n.body)
          if (ev) deps.onEvent(ev)
        } catch (e) {
          console.warn('[poller] обработчик уведомления упал', e)
        }
      }

      try {
        await deps.ack(n.receiptId, stop)
        lastUnackedReceiptId = null
        attempt = 0
      } catch (e) {
        if (stop.aborted) return
        lastUnackedReceiptId = n.receiptId
        setStatus(isAbortError(e) ? 'offline' : 'error')
        await pause(stop)
      }
    }
  }

  return {
    run,
    wake() {
      wakePending = true
      wakeController.abort()
    },
  }
}
