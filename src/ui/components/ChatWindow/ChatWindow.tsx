import { IconButton } from '@maxhub/max-ui'
import { useStore } from 'zustand'
import { formatPhone, plausiblePhone } from '../../../core/phone/phone'
import { actions } from '../../../store/actions/actions'
import { appStore } from '../../../store/store'
import { Banner } from '../Banner/Banner'
import { ChatAvatar } from '../ChatAvatar/ChatAvatar'
import { Composer } from '../Composer/Composer'
import { IconBack } from '../../lib/icons'
import { MessageList } from '../MessageList/MessageList'
import styles from './ChatWindow.module.css'
import { texts } from '../../lib/texts'

export function ChatWindow() {
  const chatId = useStore(appStore, (s) => s.activeChatId)
  const chat = useStore(appStore, (s) => (s.activeChatId ? s.chats[s.activeChatId] : undefined))
  const historyError = useStore(appStore, (s) => (s.activeChatId ? s.historyError[s.activeChatId] : false))
  const phone = plausiblePhone(chat?.phone)

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
              {phone !== '' && chat.title !== formatPhone(phone) && (
                <span className={styles.headerSub}>{formatPhone(phone)}</span>
              )}
            </div>
          </header>
          {historyError && (
            <button type="button" className={styles.historyError} onClick={() => void actions.reloadHistory(chatId)}>
              {texts.chat.historyFailed} · {texts.chat.retry}
            </button>
          )}
          <MessageList key={`messages-${chatId}`} chatId={chatId} />
          <Composer key={`composer-${chatId}`} onSend={(text) => void actions.sendMessage(chatId, text)} />
        </>
      )}
    </section>
  )
}
