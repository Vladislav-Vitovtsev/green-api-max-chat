import { IconButton } from '@maxhub/max-ui'
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { MAX_MESSAGE_LENGTH } from '../store/actions'
import { IconSend } from './icons'
import styles from './Composer.module.css'
import { texts } from './texts'

export function Composer({ onSend }: { onSend(text: string): void }) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const tooLong = text.length > MAX_MESSAGE_LENGTH
  const canSend = text.trim().length > 0 && !tooLong

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [text])

  function send() {
    if (!canSend) return
    onSend(text)
    setText('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className={styles.wrap}>
      {text.length > 3500 && (
        <div className={`${styles.counter} ${tooLong ? styles.over : ''}`}>
          {tooLong ? texts.chat.tooLong(text.length) : `${text.length} / ${MAX_MESSAGE_LENGTH}`}
        </div>
      )}
      <div className={styles.pill}>
        <textarea ref={ref} className={styles.input} rows={1} placeholder={texts.chat.placeholder}
          value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} />
        {text.length > 0 && (
          <IconButton size="small" variant="primary" aria-label={texts.chat.send} disabled={!canSend} onClick={send}>
            <IconSend />
          </IconButton>
        )}
      </div>
    </div>
  )
}
