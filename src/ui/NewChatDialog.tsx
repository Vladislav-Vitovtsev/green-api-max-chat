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
  // Элемент, куда вернуть фокус при закрытии, если document.activeElement на открытии не
  // подсказал ничего полезного (Safari без «Full Keyboard Access» не фокусирует кнопки по
  // клику — activeElement на открытии остаётся document.body, а не реальной кнопкой «+»).
  triggerRef?: RefObject<HTMLElement | null>
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Пока диалог открыт, он единственное, что доступно клавиатуре: соседи по всей цепочке
// предков до <body> должны получить inert (не фокусируются, не кликаются, скрыты от
// скринридера). Список собираем один раз при монтировании и его же используем для снятия
// inert на размонтировании — на unmount React успевает отсоединить поддерево диалога от
// DOM ДО вызова cleanup эффекта, так что повторный обход вверх от dialogRef в cleanup
// ничего бы уже не нашёл (node.parentElement обрывается на первом отсоединённом узле).
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

// Backspace/Delete над разделителем (пробел/дефис), который маска сама подставила, физически
// ничего не меняет: цифр столько же, значит при переформатировании тот же разделитель появится
// на том же месте, и для пользователя клавиша выглядит так, будто ничего не произошло. В этом
// случае убираем настоящую цифру рядом с кареткой — ту, что реально имел в виду пользователь.
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
  // Позиция каретки ДО правки — только для фолбэка, когда среда не проставляет
  // nativeEvent.inputType (см. onPhoneChange). keydown срабатывает раньше, чем браузер
  // применяет Backspace/Delete, поэтому здесь ещё видна каретка «до».
  const caretBeforeEdit = useRef<number | null>(null)

  // Открытие: запоминаем, что было в фокусе (обычно кнопка «+»), фокусируем поле ввода и
  // прячем фон от клавиатуры/скринридера. document.body в момент открытия не считается
  // «был в фокусе»: Safari без «Full Keyboard Access» не переводит фокус на кнопку по клику
  // мышью, так что activeElement там остаётся body, а не реальным триггером — в этом случае
  // полагаемся на явный triggerRef. Закрытие: снимаем inert и возвращаем фокус на
  // previouslyFocused (если он был осмысленным) или на triggerRef.current — иначе после
  // диалога фокус проваливается в начало документа.
  useEffect(() => {
    const dialog = dialogRef.current
    const active = document.activeElement
    const previouslyFocused = active instanceof HTMLElement && active !== document.body ? active : null
    // Снимок .current на момент открытия, а не чтение в cleanup: к моменту размонтирования
    // значение того же ref-объекта могло бы уже указывать на другой узел.
    const trigger = triggerRef?.current ?? null
    inputRef.current?.focus()
    const backgroundSiblings = dialog ? collectBackgroundSiblings(dialog) : []
    for (const el of backgroundSiblings) el.setAttribute('inert', '')
    return () => {
      for (const el of backgroundSiblings) el.removeAttribute('inert')
      ;(previouslyFocused ?? trigger)?.focus()
    }
    // triggerRef.current уже снят в trigger выше — читать сам triggerRef эффекту больше незачем,
    // а как проп для «на время жизни диалога» переменная переоткрывать его не нужно.
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
      // Решаем по типу события, а не по разнице длин: разница длин при равном числе цифр
      // бывает и от paste, заменившего выделение (см. тест) — там цифры трогать не нужно.
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
