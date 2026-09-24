import { IconButton } from '@maxhub/max-ui'
import { useStore } from 'zustand'
import { formatPhone } from '../core/phone'
import { actions } from '../store/actions'
import { appStore } from '../store/store'
import { Banner } from './Banner'
import { ChatAvatar } from './ChatAvatar'
import { Composer } from './Composer'
import { IconBack } from './icons'
import { MessageList } from './MessageList'
import styles from './ChatWindow.module.css'
import { texts } from './texts'

export function ChatWindow() {
  const chatId = useStore(appStore, (s) => s.activeChatId)
  const chat = useStore(appStore, (s) => (s.activeChatId ? s.chats[s.activeChatId] : undefined))
  const historyError = useStore(appStore, (s) => (s.activeChatId ? s.historyError[s.activeChatId] : false))

  return (
    <section className={`${styles.window} pattern-bg`}>
      <Banner />
      {!chat || !chatId ? (
        <div className={styles.placeholder}><span>{texts.chat.selectPrompt}</span></div>
      ) : (
        <>
          <header className={styles.header}>
            <IconButton className={styles.back} size="small" variant="ghost" aria-label={texts.chat.back}
              onClick={() => void actions.openChat(null)}>
              <IconBack />
            </IconButton>
            <ChatAvatar chatId={chatId} title={chat.title} size={40} />
            <div className={styles.headerText}>
              <span className={styles.headerTitle}>{chat.title}</span>
              <span className={styles.headerSub}>{formatPhone(chat.phone)}</span>
            </div>
          </header>
          {historyError && (
            <button type="button" className={styles.historyError} onClick={() => void actions.reloadHistory(chatId)}>
              {texts.chat.historyFailed} · {texts.chat.retry}
            </button>
          )}
          <MessageList key={chatId} chatId={chatId} />
          <Composer onSend={(text) => void actions.sendMessage(chatId, text)} />
        </>
      )}
    </section>
  )
}
