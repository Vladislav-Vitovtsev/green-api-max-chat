export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const cap = Math.min(30_000, 1000 * 2 ** Math.max(0, attempt - 1))
  return Math.max(250, Math.floor(random() * cap))
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}
