import { IconButton, Input, Spinner } from '@maxhub/max-ui'
import { useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { formatPhone, normalizePhone } from '../core/phone'
import { actions } from '../store/actions'
import { selectActiveChatId, selectChatOrder } from '../store/selectors'
import { appStore } from '../store/store'
import { ChatListItem } from './ChatListItem'
import { IconLogout, IconPlus } from './icons'
import { NewChatDialog } from './NewChatDialog'
import styles from './ChatList.module.css'
import { errorText, texts } from './texts'

export function ChatList() {
  const order = useStore(appStore, selectChatOrder)
  const activeId = useStore(appStore, selectActiveChatId)
  const titles = useStore(appStore, useShallow((s) => s.chatOrder.map((id) => `${s.chats[id]?.title ?? ''} ${s.chats[id]?.phone ?? ''}`)))
  const phones = useStore(appStore, useShallow((s) => Object.values(s.chats).map((c) => c.phone)))
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const newChatButtonRef = useRef<HTMLButtonElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/[\s()+-]/g, '')
    if (!q) return order
    return order.filter((_, i) => titles[i]!.toLowerCase().replace(/[\s()+-]/g, '').includes(q))
  }, [order, titles, query])

  const phoneCheck = useMemo(() => normalizePhone(query), [query])
  const showWrite = phoneCheck.ok && !phones.includes(phoneCheck.phone)

  function onSearchChange(v: string) {
    setQuery(v)
    setCreateError(null)
  }

  async function writeToNumber() {
    if (creating || !phoneCheck.ok) return
    setCreating(true)
    setCreateError(null)
    const r = await actions.createChat(query)
    setCreating(false)
    if (r.ok) {
      setQuery('')
      // Строка «Написать <номер>» (где сейчас фокус) пропадёт из DOM вместе с query — без
      // явного переноса фокус проваливается в document.body, как раньше с диалогом (U1).
      searchInputRef.current?.focus()
      return
    }
    setCreateError(r.error === 'rateLimit' ? texts.newChat.limit : errorText(r.error))
  }

  return (
    <aside className={styles.list}>
      <header className={styles.header}>
        <span className={styles.headerStart}>
          <IconButton size="medium" variant="secondary" className={styles.mobileOnly} aria-label={texts.chats.logout}
            onClick={() => actions.logout()}>
            <IconLogout />
          </IconButton>
          <h1 className={styles.title}>{texts.chats.title}</h1>
        </span>
        <IconButton ref={newChatButtonRef} size="xsmall" variant="primary" style={{ borderRadius: '50%' }} aria-label={texts.chats.newChat}
          onClick={() => setDialog(true)}>
          <IconPlus width={20} height={20} />
        </IconButton>
      </header>
      <div className={styles.search}>
        <Input ref={searchInputRef} size="medium" placeholder={texts.chats.search} value={query} onChange={(e) => onSearchChange(e.target.value)} withClearButton />
      </div>
      {showWrite && phoneCheck.ok && (
        <div className={styles.writeWrap}>
          <button type="button" className={styles.writeRow} disabled={creating} onClick={() => void writeToNumber()}>
            {creating && <Spinner size={20} appearance="neutral-themed" />}
            <span className={styles.writeLabel}>{texts.chats.writeTo(formatPhone(phoneCheck.phone))}</span>
          </button>
          {createError && <p role="alert" className={styles.writeError}>{createError}</p>}
        </div>
      )}
      <div className={styles.scroll}>
        {order.length === 0 && <p className={styles.empty}>{texts.chats.empty}</p>}
        {order.length > 0 && visible.length === 0 && <p className={styles.empty}>{texts.chats.nothingFound}</p>}
        {visible.map((id) => (
          <ChatListItem key={id} chatId={id} active={id === activeId} onOpen={(cid) => void actions.openChat(cid)} />
        ))}
      </div>
      {dialog && <NewChatDialog onClose={() => setDialog(false)} onCreate={actions.createChat} triggerRef={newChatButtonRef} />}
    </aside>
  )
}
