import { Button, Input } from '@maxhub/max-ui'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { CreateChatResult } from '../store/actions'
import styles from './NewChatDialog.module.css'
import { errorText, texts } from './texts'

type Props = { onCreate(input: string): Promise<CreateChatResult>; onClose(): void }

export function NewChatDialog({ onCreate, onClose }: Props) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  function closeIfIdle() {
    if (!busy) onClose()
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const r = await onCreate(value)
    setBusy(false)
    if (r.ok) return onClose()
    setError(r.error === 'rateLimit' ? texts.newChat.limit : errorText(r.error))
  }

  return (
    <div className={styles.backdrop} onClick={closeIfIdle}>
      <form role="dialog" aria-modal="true" aria-labelledby="new-chat-title" className={styles.dialog}
        onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 id="new-chat-title" className={styles.title}>{texts.newChat.title}</h2>
        <label className={styles.field}>
          <span>{texts.newChat.phone}</span>
          <Input ref={inputRef} aria-label={texts.newChat.phone} type="tel" inputMode="tel" autoComplete="off"
            placeholder={texts.newChat.placeholder} value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>{texts.newChat.cancel}</Button>
          <Button type="submit" loading={busy} disabled={!value.trim()}>{texts.newChat.submit}</Button>
        </div>
      </form>
    </div>
  )
}
