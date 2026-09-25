import { useCallback, useLayoutEffect, useRef } from 'react'
import { useStore } from 'zustand'
import { actions } from '../../../store/actions/actions'
import { selectOrder } from '../../../store/selectors'
import { appStore } from '../../../store/store'
import styles from '../ChatWindow/ChatWindow.module.css'
import { formatDay } from '../../lib/format'
import { MessageBubble } from '../MessageBubble/MessageBubble'
import { texts } from '../../lib/texts'

const EMPTY: string[] = []

export function MessageList({ chatId }: { chatId: string }) {
  const order = useStore(appStore, selectOrder(chatId)) ?? EMPTY
  const byId = useStore(appStore, (s) => s.messagesById)
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const lastCount = useRef(0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const lastId = order[order.length - 1]
    const lastIsOwn = lastId ? appStore.getState().messagesById[lastId]?.direction === 'out' : false
    const grew = order.length > lastCount.current
    if (stick.current || (grew && lastIsOwn)) el.scrollTop = el.scrollHeight
    lastCount.current = order.length
  }, [order])

  const onScroll = () => {
    const el = ref.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  const onRetry = useCallback((mid: string) => void actions.retryMessage(mid), [])

  if (order.length === 0) return <div className={styles.emptyMessages}>{texts.chat.noMessages}</div>

  const days: { day: string; ids: string[] }[] = []
  for (const id of order) {
    const day = formatDay(byId[id]?.timestamp ?? 0)
    const last = days[days.length - 1]
    if (last && last.day === day) last.ids.push(id)
    else days.push({ day, ids: [id] })
  }

  return (
    <div ref={ref} className={styles.messages} onScroll={onScroll}>
      {days.map(({ day, ids }) => (
        <section key={`d-${day}`} className={styles.day}>
          <div className={styles.capsule}><span>{day}</span></div>
          {ids.map((id) => <MessageBubble key={id} id={id} onRetry={onRetry} />)}
        </section>
      ))}
    </div>
  )
}
