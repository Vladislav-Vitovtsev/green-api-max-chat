import { backoffDelay, sleep } from './backoff'

describe('backoffDelay', () => {
  it('растёт экспоненциально до cap 30s и не меньше 250ms', () => {
    expect(backoffDelay(1, () => 1)).toBe(1000)
    expect(backoffDelay(3, () => 1)).toBe(4000)
    expect(backoffDelay(20, () => 1)).toBe(30000)
    expect(backoffDelay(5, () => 0)).toBe(250)
  })
})

describe('sleep', () => {
  it('прерывается сигналом и не реджектится', async () => {
    const c = new AbortController()
    const p = sleep(60_000, c.signal)
    c.abort()
    await expect(p).resolves.toBeUndefined()
  })
  it('сразу резолвится на уже прерванном сигнале', async () => {
    await expect(sleep(60_000, AbortSignal.abort())).resolves.toBeUndefined()
  })
})
