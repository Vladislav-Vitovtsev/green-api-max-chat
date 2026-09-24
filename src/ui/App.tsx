import { useEffect } from 'react'
import { useStore } from 'zustand'
import { actions } from '../store/actions'
import { appStore } from '../store/store'
import { ChatLayout } from './ChatLayout'
import { LoginScreen } from './LoginScreen'

let restored = false

export function App() {
  const credentials = useStore(appStore, (s) => s.credentials)
  const authError = useStore(appStore, (s) => s.authError)

  useEffect(() => {
    if (!restored) {
      restored = true
      actions.restore()
    }
    const wake = () => document.visibilityState === 'visible' && actions.wake()
    const online = () => actions.wake()
    const storage = (e: StorageEvent) => {
      if (e.key === 'max-chat:data') void appStore.persist.rehydrate()
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', online)
    window.addEventListener('storage', storage)
    return () => {
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', online)
      window.removeEventListener('storage', storage)
    }
  }, [])

  return credentials ? <ChatLayout /> : <LoginScreen onLogin={actions.login} initialError={authError} />
}

// R6: HMR-dispose зовёт stop() (обрыв опроса без очистки кредов/данных), а не
// logout() — иначе после каждой правки App.tsx в dev пришлось бы входить заново.
if (import.meta.hot) {
  import.meta.hot.dispose(() => actions.stop())
}
