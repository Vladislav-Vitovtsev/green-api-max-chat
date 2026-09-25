import { Button, Typography } from '@maxhub/max-ui'
import { useEffect, useState } from 'react'
import { useStore } from 'zustand'
import { actions } from '../store/actions'
import { selectCredentials } from '../store/selectors'
import { appStore } from '../store/store'
import { ChatLayout } from './ChatLayout'
import { LoginScreen } from './LoginScreen'
import styles from './LoginScreen.module.css'
import { texts } from './texts'

function OtherTabScreen() {
  const [stealing, setStealing] = useState(false)
  const takeOver = () => {
    setStealing(true)
    void actions.takeOver().finally(() => setStealing(false))
  }
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <Typography.Headline variant="small" className={styles.title}>{texts.otherTab.title}</Typography.Headline>
        <Typography.Body variant="small" className={styles.subtitle}>{texts.otherTab.hint}</Typography.Body>
        <Button size="large" stretched onClick={takeOver} disabled={stealing} loading={stealing}>{texts.otherTab.takeOver}</Button>
      </div>
    </div>
  )
}

export function App() {
  const credentials = useStore(appStore, selectCredentials)
  const authError = useStore(appStore, (s) => s.authError)
  const tab = useStore(appStore, (s) => s.tab)

  useEffect(() => {
    actions.start()
    const wake = () => document.visibilityState === 'visible' && actions.wake()
    const online = () => actions.wake()
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', online)
    return () => {
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', online)
    }
  }, [])

  if (tab === 'pending') return null
  if (tab === 'blocked') return <OtherTabScreen />
  return credentials ? <ChatLayout /> : <LoginScreen onLogin={actions.login} initialError={authError} />
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => actions.stop())
}
