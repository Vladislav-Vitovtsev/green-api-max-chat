import { memo } from 'react'
import { useStore } from 'zustand'
import type { MessageStatus } from '../core/model'
import { captionOf } from '../core/text'
import { selectMessage } from '../store/selectors'
import { appStore } from '../store/store'
import { formatClock } from './format'
import { IconAlert, IconCheck, IconClock, IconDoubleCheck } from './icons'
import styles from './MessageBubble.module.css'
import { texts } from './texts'

export function StatusIcon({ status }: { status: MessageStatus }) {
  if (status === 'pending') return <IconClock aria-label={texts.status.pending} className={styles.status} />
  if (status === 'sent') return <IconCheck aria-label={texts.status.sent} className={styles.status} />
  if (status === 'delivered') return <IconDoubleCheck aria-label={texts.status.delivered} className={styles.status} />
  if (status === 'read') return <IconDoubleCheck aria-label={texts.status.read} className={`${styles.status} ${styles.read}`} />
  return <IconAlert aria-label={texts.status.failed} className={styles.failedIcon} />
}

export const MessageBubble = memo(function MessageBubble({ id, onRetry }: { id: string; onRetry(id: string): void }) {
  const m = useStore(appStore, selectMessage(id))
  const peer = useStore(appStore, (s) => (m ? s.chats[m.chatId] : undefined))
  const quoted = useStore(appStore, (s) => (m?.quote ? s.messagesById[m.quote.id] : undefined))
  if (!m) return null
  const out = m.direction === 'out'
  const caption = captionOf(m)
  const quote = m.quote
  const quoteAuthor = quote?.fromMe ? texts.chat.quoteFromMe : (peer?.title ?? '')
  const quoteLine = quoted
    ? (quoted.deleted ? texts.chat.deleted : quoted.mediaLabel ?? quoted.text)
    : (quote?.mediaLabel ?? quote?.text ?? '')
  return (
    <div className={`${styles.row} ${out ? styles.out : styles.in}`}>
      <div className={`${styles.bubble} ${out ? styles.bubbleOut : styles.bubbleIn}`}>
        {quote && !m.deleted && (
          <div className={styles.quote}>
            <span className={styles.quoteAuthor}>{quoteAuthor}</span>
            <span className={styles.quoteText}>{quoteLine}</span>
          </div>
        )}
        {m.deleted ? (
          <span className={`${styles.text} ${styles.deleted}`}>{texts.chat.deleted}</span>
        ) : (
          <>
            {m.mediaLabel && <span className={styles.mediaLabel}>{m.mediaLabel}</span>}
            {(!m.mediaLabel || caption) && <span className={styles.text}>{caption}</span>}
          </>
        )}
        <span className={styles.meta}>
          {m.edited && !m.deleted && <span className={styles.edited}>{texts.chat.edited}</span>}
          {formatClock(m.timestamp)}
          {out && <StatusIcon status={m.status} />}
        </span>
      </div>
      {m.status === 'failed' && id.startsWith('local-') && (
        <button type="button" className={styles.retry} onClick={() => onRetry(id)}>{texts.chat.retry}</button>
      )}
    </div>
  )
})
