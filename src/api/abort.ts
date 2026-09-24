// AbortSignal.any (Baseline 2024) не везде доступен на рантайме, откуда открывают демо
// (старый Safari/WebView, встроенный браузер мессенджера) — на случай отсутствия собираем то
// же поведение вручную: контроллер, который абортится, как только абортится любой из входных
// сигналов, с той же reason. Используется вместо AbortSignal.any везде в кодовой базе (api,
// core/poller.ts) — core может импортировать api, обратное запрещено ESLint-границей слоёв.
export function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals)

  const controller = new AbortController()
  // Один сигнал абортится — комбинированный тоже, но остальные входные сигналы (например,
  // 30-секундный таймаут и долгоживущий session.signal) могли ещё не сработать и без явной
  // отписки продолжали бы висеть слушателями неограниченно — держат замыкание на controller
  // и сам сигнал до тех пор, пока каждый из них не абортится сам по себе (иногда никогда).
  // Снимаем разом все подписки, как только комбинированный сигнал определился.
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
