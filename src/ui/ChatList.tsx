import { IconButton, Input } from '@maxhub/max-ui'
import { useMemo, useState } from 'react'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { actions } from '../store/actions'
import { appStore } from '../store/store'
import { ChatListItem } from './ChatListItem'
import { IconLogout, IconPlus } from './icons'
import { NewChatDialog } from './NewChatDialog'
import styles from './ChatList.module.css'
import { texts } from './texts'

export function ChatList() {
  const order = useStore(appStore, (s) => s.chatOrder)
  const activeId = useStore(appStore, (s) => s.activeChatId)
  const titles = useStore(appStore, useShallow((s) => s.chatOrder.map((id) => `${s.chats[id]?.title ?? ''} ${s.chats[id]?.phone ?? ''}`)))
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState(false)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/[\s()+-]/g, '')
    if (!q) return order
    return order.filter((_, i) => titles[i]!.toLowerCase().replace(/[\s()+-]/g, '').includes(q))
  }, [order, titles, query])

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
        <IconButton size="medium" variant="primary" aria-label={texts.chats.newChat} onClick={() => setDialog(true)}>
          <IconPlus />
        </IconButton>
      </header>
      <div className={styles.search}>
        <Input size="medium" placeholder={texts.chats.search} value={query} onChange={(e) => setQuery(e.target.value)} withClearButton />
      </div>
      <div className={styles.scroll}>
        {order.length === 0 && <p className={styles.empty}>{texts.chats.empty}</p>}
        {order.length > 0 && visible.length === 0 && <p className={styles.empty}>{texts.chats.nothingFound}</p>}
        {visible.map((id) => (
          <ChatListItem key={id} chatId={id} active={id === activeId} onOpen={(cid) => void actions.openChat(cid)} />
        ))}
      </div>
      {dialog && <NewChatDialog onClose={() => setDialog(false)} onCreate={actions.createChat} />}
    </aside>
  )
}
