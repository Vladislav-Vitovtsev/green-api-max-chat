import { IconChats, IconLogout } from './icons'
import styles from './ChatLayout.module.css'
import { texts } from './texts'

export function NavRail({ onLogout }: { onLogout(): void }) {
  return (
    <nav className={styles.rail} aria-label="Навигация">
      <span className={`${styles.railItem} ${styles.railActive}`}><IconChats /><small>{texts.chats.title}</small></span>
      <button type="button" className={styles.railItem} onClick={onLogout}><IconLogout /><small>{texts.chats.logout}</small></button>
    </nav>
  )
}
