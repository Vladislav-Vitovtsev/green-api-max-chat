export function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals)

  const controller = new AbortController()
  const pairs: [AbortSignal, () => void][] = []
  const cleanup = () => {
    for (const [s, listener] of pairs) s.removeEventListener('abort', listener)
    pairs.length = 0
  }
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason)
      cleanup()
      break
    }
    const listener = () => {
      controller.abort(s.reason)
      cleanup()
    }
    s.addEventListener('abort', listener)
    pairs.push([s, listener])
  }
  return controller.signal
}
