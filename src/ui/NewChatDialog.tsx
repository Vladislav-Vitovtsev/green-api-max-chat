import { Button, Input } from '@maxhub/max-ui'
import {
  useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react'
import { formatPhoneInput } from '../core/phone'
import type { CreateChatResult } from '../store/actions'
import styles from './NewChatDialog.module.css'
import { errorText, texts } from './texts'

type Props = {
  onCreate(input: string): Promise<CreateChatResult>
  onClose(): void
  triggerRef?: RefObject<HTMLElement | null>
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function collectBackgroundSiblings(dialog: HTMLElement): HTMLElement[] {
  const siblings: HTMLElement[] = []
  let node: HTMLElement | null = dialog
  while (node && node !== document.body) {
    const parent: HTMLElement | null = node.parentElement
    if (parent) {
      for (const sibling of Array.from(parent.children)) {
        if (sibling !== node && sibling instanceof HTMLElement) siblings.push(sibling)
      }
    }
    node = parent
  }
  return siblings
}

function removeDigitBeforeCaret(raw: string, caret: number): string {
  for (let i = caret - 1; i >= 0; i--) {
    if (/\d/.test(raw[i]!)) return raw.slice(0, i) + raw.slice(i + 1)
  }
  return raw
}

function removeDigitAfterCaret(raw: string, caret: number): string {
  for (let i = caret; i < raw.length; i++) {
    if (/\d/.test(raw[i]!)) return raw.slice(0, i) + raw.slice(i + 1)
  }
  return raw
}

export function NewChatDialog({ onCreate, onClose, triggerRef }: Props) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLFormElement>(null)
  const caretBeforeEdit = useRef<number | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    const active = document.activeElement
    const previouslyFocused = active instanceof HTMLElement && active !== document.body ? active : null
    const trigger = triggerRef?.current ?? null
    inputRef.current?.focus()
    const backgroundSiblings = dialog ? collectBackgroundSiblings(dialog) : []
    for (const el of backgroundSiblings) el.setAttribute('inert', '')
    return () => {
      for (const el of backgroundSiblings) el.removeAttribute('inert')
      ;(previouslyFocused ?? trigger)?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (focusable.length === 0) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  function closeIfIdle() {
    if (!busy) onClose()
  }

  function onPhoneKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    caretBeforeEdit.current = e.currentTarget.selectionStart
  }

  function onPhoneChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    const caret = e.target.selectionStart ?? raw.length
    const newDigits = raw.replace(/\D/g, '')
    const prevDigits = value.replace(/\D/g, '')
    const separatorDeleted = raw.length < value.length && newDigits.length === prevDigits.length

    let effective = raw
    if (separatorDeleted) {
      const inputType = (e.nativeEvent as InputEvent).inputType
      const isBackward = inputType ? inputType === 'deleteContentBackward' : caretBeforeEdit.current === caret + 1
      const isForward = inputType ? inputType === 'deleteContentForward' : caretBeforeEdit.current === caret
      if (isBackward) effective = removeDigitBeforeCaret(raw, caret)
      else if (isForward) effective = removeDigitAfterCaret(raw, caret)
    }
    setValue(formatPhoneInput(effective))
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
      <form ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="new-chat-title" className={styles.dialog}
        onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 id="new-chat-title" className={styles.title}>{texts.newChat.title}</h2>
        <label className={styles.field}>
          <span>{texts.newChat.phone}</span>
          <Input ref={inputRef} aria-label={texts.newChat.phone} type="tel" inputMode="tel" autoComplete="off"
            placeholder={texts.newChat.placeholder} value={value} onChange={onPhoneChange} onKeyDown={onPhoneKeyDown} />
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
