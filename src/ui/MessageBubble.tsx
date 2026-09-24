import { useStore } from 'zustand'
import type { MessageStatus } from '../core/model'
import { selectMessage } from '../store/selectors'
import { appStore } from '../store/store'
import { formatClock } from './format'
import { IconAlert, IconCheck, IconClock, IconDoubleCheck } from './icons'
import styles from './MessageBubble.module.css'
import { texts } from './texts'

export function StatusIcon({ status }: { status: MessageStatus }) {
  if (status === 'pending') return <IconClock aria-label="Отправляется" className={styles.status} />
  if (status === 'sent') return <IconCheck aria-label="Отправлено" className={styles.status} />
  if (status === 'delivered') return <IconDoubleCheck aria-label="Доставлено" className={styles.status} />
  if (status === 'read') return <IconDoubleCheck aria-label="Прочитано" className={`${styles.status} ${styles.read}`} />
  return <IconAlert aria-label="Не отправлено" className={styles.failedIcon} />
}

export function MessageBubble({ id, onRetry }: { id: string; onRetry(id: string): void }) {
  const m = useStore(appStore, selectMessage(id))
  if (!m) return null
  const out = m.direction === 'out'
  return (
    <div className={`${styles.row} ${out ? styles.out : styles.in}`}>
      <div className={`${styles.bubble} ${out ? styles.bubbleOut : styles.bubbleIn}`}>
        <span className={styles.text}>{m.text}</span>
        <span className={styles.meta}>
          {formatClock(m.timestamp)}
          {out && <StatusIcon status={m.status} />}
        </span>
      </div>
      {m.status === 'failed' && (
        <button type="button" className={styles.retry} onClick={() => onRetry(id)}>{texts.chat.retry}</button>
      )}
    </div>
  )
}
