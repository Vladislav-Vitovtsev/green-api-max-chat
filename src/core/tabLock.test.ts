import { fakeLocks } from '../test/fakeLocks'
import { acquireActiveTab, type LocksLike } from './tabLock'

const WAIT = 30
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const flush = () => sleep(0)

function tab(locks: LocksLike | null) {
  const log: string[] = []
  const handle = acquireActiveTab({
    locks,
    waitMs: WAIT,
    onActive: () => log.push('active'),
    onBlocked: () => log.push('blocked'),
    onLost: () => log.push('lost'),
  })
  return { log, handle }
}

// «Другая вкладка», которая держит лок, пока не вызовут release().
function holdElsewhere(locks: LocksLike) {
  let release!: () => void
  locks.request('max-chat:active-tab', { mode: 'exclusive' }, () => new Promise<void>((r) => (release = r))).catch(() => {})
  return () => release()
}

describe('acquireActiveTab', () => {
  it('свободный лок → вкладка активна', async () => {
    const a = tab(fakeLocks())
    await flush()
    expect(a.log).toEqual(['active'])
  })

  it('лок занят → onBlocked по таймауту ожидания, без очереди после него', async () => {
    const locks = fakeLocks()
    const a = tab(locks)
    await flush()
    const b = tab(locks)
    await flush()
    expect(b.log).toEqual([])
    await sleep(WAIT * 3)
    expect(a.log).toEqual(['active'])
    expect(b.log).toEqual(['blocked'])
  })

  it('лок освободился в пределах ожидания (F5: старый документ ещё выгружается) → вкладка активна', async () => {
    const locks = fakeLocks()
    const release = holdElsewhere(locks)
    await flush()
    const a = tab(locks)
    await sleep(WAIT / 3)
    release()
    await sleep(WAIT * 3)
    expect(a.log).toEqual(['active'])
  })

  it('takeOver забирает лок: старая вкладка получает onLost, новая onActive', async () => {
    const locks = fakeLocks()
    const a = tab(locks)
    await flush()
    const b = tab(locks)
    await sleep(WAIT * 3)
    await b.handle.takeOver()
    await flush()
    expect(a.log).toEqual(['active', 'lost'])
    expect(b.log).toEqual(['blocked', 'active'])

    // Лок у B: третья вкладка заблокирована, A может забрать его обратно.
    const c = tab(locks)
    await sleep(WAIT * 3)
    await a.handle.takeOver()
    await flush()
    expect(c.log).toEqual(['blocked'])
    expect(a.log).toEqual(['active', 'lost', 'active'])
    expect(b.log).toEqual(['blocked', 'active', 'lost'])
  })

  it('повторный takeOver во время перехвата и takeOver держателем лока ничего не делают', async () => {
    const locks = fakeLocks()
    const a = tab(locks)
    await flush()
    const b = tab(locks)
    await sleep(WAIT * 3)
    const first = b.handle.takeOver()
    const second = b.handle.takeOver()
    await Promise.all([first, second])
    await b.handle.takeOver()
    await flush()
    expect(a.log).toEqual(['active', 'lost'])
    expect(b.log).toEqual(['blocked', 'active'])
  })

  it('Web Locks недоступны → вкладка всегда активна', () => {
    const a = tab(null)
    expect(a.log).toEqual(['active'])
  })

  it('отказ request до получения лока, не по таймауту → ведём себя как без Web Locks', async () => {
    const locks: LocksLike = { request: (() => Promise.reject(new DOMException('x', 'SecurityError'))) as unknown as LocksLike['request'] }
    const a = tab(locks)
    await flush()
    expect(a.log).toEqual(['active'])
  })
})
