import { useStore } from 'zustand'
import { actions } from '../../../store/actions/actions'
import { selectActiveChatId } from '../../../store/selectors'
import { appStore } from '../../../store/store'
import { ChatList } from '../ChatList/ChatList'
import { ChatWindow } from '../ChatWindow/ChatWindow'
import styles from './ChatLayout.module.css'
import { NavRail } from '../NavRail/NavRail'

export function ChatLayout() {
  const activeId = useStore(appStore, selectActiveChatId)
  return (
    <div className={`${styles.layout} ${activeId ? styles.chatOpen : ''}`}>
      <NavRail onLogout={() => actions.logout()} />
      <ChatList />
      <ChatWindow />
    </div>
  )
}
