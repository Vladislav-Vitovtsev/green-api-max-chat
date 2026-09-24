import { useStore } from 'zustand'
import { selectBanner } from '../store/selectors'
import { appStore } from '../store/store'
import styles from './Banner.module.css'
import { texts } from './texts'

export function Banner() {
  const banner = useStore(appStore, selectBanner)
  if (!banner) return null
  return (
    <div role="status" className={`${styles.banner} ${banner === 'notAuthorized' || banner === 'quota' ? styles.warn : ''}`}>
      {texts.banner[banner]}
      {banner === 'notAuthorized' && (
        <a href="https://console.green-api.com" target="_blank" rel="noreferrer">{texts.banner.openConsole}</a>
      )}
    </div>
  )
}
