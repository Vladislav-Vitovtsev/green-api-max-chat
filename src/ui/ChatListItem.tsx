import { useStore } from 'zustand'
import { appStore } from '../store/store'
import { selectChat, selectLastMessage } from '../store/selectors'
import { ChatAvatar } from './ChatAvatar'
import { formatTime } from './format'
import { StatusIcon } from './MessageBubble'
import styles from './ChatList.module.css'
import { texts } from './texts'

export function ChatListItem({ chatId, active, onOpen }: { chatId: string; active: boolean; onOpen(id: string): void }) {
  const chat = useStore(appStore, selectChat(chatId))
  const last = useStore(appStore, selectLastMessage(chatId))
  if (!chat) return null
  return (
    <button type="button" className={`${styles.cell} ${active ? styles.active : ''}`} onClick={() => onOpen(chatId)}
      aria-current={active ? 'true' : undefined}>
      <ChatAvatar chatId={chatId} title={chat.title} />
      <span className={styles.body}>
        <span className={styles.row}>
          <span className={styles.name}>{chat.title}</span>
          <span className={styles.meta}>
            {last?.direction === 'out' && <StatusIcon status={last.status} />}
            {last && formatTime(last.timestamp)}
          </span>
        </span>
        <span className={styles.preview}>{last ? (last.direction === 'out' ? `Вы: ${last.text}` : last.text) : texts.chat.noMessages}</span>
      </span>
    </button>
  )
}
