import { useStore } from 'zustand'
import { actions } from '../store/actions'
import { appStore } from '../store/store'
import { ChatList } from './ChatList'
import { ChatWindow } from './ChatWindow'
import styles from './ChatLayout.module.css'
import { NavRail } from './NavRail'

export function ChatLayout() {
  const activeId = useStore(appStore, (s) => s.activeChatId)
  return (
    <div className={`${styles.layout} ${activeId ? styles.chatOpen : ''}`}>
      <NavRail onLogout={() => actions.logout()} />
      <ChatList />
      <ChatWindow />
    </div>
  )
}
