import { IconChats, IconLogout } from '../../lib/icons'
import styles from '../ChatLayout/ChatLayout.module.css'
import { texts } from '../../lib/texts'

export function NavRail({ onLogout }: { onLogout(): void }) {
  return (
    <nav className={styles.rail} aria-label={texts.nav.label}>
      <span className={`${styles.railItem} ${styles.railActive}`}><IconChats /><small>{texts.chats.title}</small></span>
      <button type="button" className={styles.railItem} onClick={onLogout}><IconLogout /><small>{texts.chats.logout}</small></button>
    </nav>
  )
}
