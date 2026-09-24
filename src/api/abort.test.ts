import { anySignal } from './abort'

describe('anySignal', () => {
  it('с нативным AbortSignal.any: абортится, когда абортится любой из входных сигналов', () => {
    const a = new AbortController()
    const b = new AbortController()
    const combined = anySignal([a.signal, b.signal])
    expect(combined.aborted).toBe(false)
    b.abort('причина b')
    expect(combined.aborted).toBe(true)
    expect(combined.reason).toBe('причина b')
  })

  it('без нативного AbortSignal.any (фолбэк): то же поведение через AbortController', () => {
    const native = AbortSignal.any
    // @ts-expect-error - симулируем рантайм без AbortSignal.any (старый Safari/WebView)
    AbortSignal.any = undefined
    try {
      const a = new AbortController()
      const b = new AbortController()
      const combined = anySignal([a.signal, b.signal])
      expect(combined.aborted).toBe(false)
      a.abort('причина a')
      expect(combined.aborted).toBe(true)
      expect(combined.reason).toBe('причина a')
    } finally {
      AbortSignal.any = native
    }
  })

  it('фолбэк: после аборта одного сигнала снимает подписку со всех ещё не сработавших (не копит слушателей)', () => {
    const native = AbortSignal.any
    // @ts-expect-error - симулируем рантайм без AbortSignal.any
    AbortSignal.any = undefined
    try {
      const a = new AbortController()
      const b = new AbortController()
      const removeSpy = vi.spyOn(b.signal, 'removeEventListener')
      anySignal([a.signal, b.signal])
      a.abort('причина a')
      // b ещё не абортился сам, но комбинированный сигнал уже определился по a — подписку на b
      // снимает cleanup, а не только «once» на собственное событие b.
      expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function))
    } finally {
      AbortSignal.any = native
    }
  })

  it('фолбэк: если один из входных сигналов уже abort\'нут до вызова, результат сразу aborted', () => {
    const native = AbortSignal.any
    // @ts-expect-error - симулируем рантайм без AbortSignal.any
    AbortSignal.any = undefined
    try {
      const a = new AbortController()
      a.abort('уже abort\'нут')
      const combined = anySignal([a.signal, new AbortController().signal])
      expect(combined.aborted).toBe(true)
      expect(combined.reason).toBe('уже abort\'нут')
    } finally {
      AbortSignal.any = native
    }
  })
})
