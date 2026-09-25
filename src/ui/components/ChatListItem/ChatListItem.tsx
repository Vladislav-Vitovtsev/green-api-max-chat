import { useStore } from 'zustand'
import type { Message } from '../../../core/model'
import { captionOf } from '../../../core/messages/text'
import { appStore } from '../../../store/store'
import { selectChat, selectLastMessage, selectUnread } from '../../../store/selectors'
import { ChatAvatar } from '../ChatAvatar/ChatAvatar'
import { formatTime } from '../../lib/format'
import { StatusIcon } from '../MessageBubble/MessageBubble'
import styles from '../ChatList/ChatList.module.css'
import { texts } from '../../lib/texts'

function previewText(m: Message): string {
  const caption = captionOf(m)
  const body = m.deleted ? texts.chat.deleted : m.mediaLabel ? `${m.mediaLabel}${caption ? ` ${caption}` : ''}` : m.text
  return m.direction === 'out' ? `${texts.chat.you}${body}` : body
}

export function ChatListItem({ chatId, active, onOpen }: { chatId: string; active: boolean; onOpen(id: string): void }) {
  const chat = useStore(appStore, selectChat(chatId))
  const last = useStore(appStore, selectLastMessage(chatId))
  const unread = useStore(appStore, selectUnread(chatId))
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
        <span className={styles.previewRow}>
          <span className={styles.preview}>{last ? previewText(last) : texts.chat.noMessages}</span>
          {unread > 0 && (
            <span className={styles.badge} role="img" aria-label={texts.chat.unreadAria(unread)}>
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </span>
      </span>
    </button>
  )
}
