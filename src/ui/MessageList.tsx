import { useCallback, useLayoutEffect, useRef } from 'react'
import { useStore } from 'zustand'
import { actions } from '../store/actions'
import { selectOrder } from '../store/selectors'
import { appStore } from '../store/store'
import styles from './ChatWindow.module.css'
import { formatDay } from './format'
import { MessageBubble } from './MessageBubble'
import { texts } from './texts'

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

  return (
    <div ref={ref} className={styles.messages} onScroll={onScroll}>
      {order.map((id, i) => {
        const day = formatDay(byId[id]?.timestamp ?? 0)
        const prevId = order[i - 1]
        const prevDay = prevId ? formatDay(byId[prevId]?.timestamp ?? 0) : ''
        const capsule = day !== prevDay ? <div key={`d-${id}`} className={styles.capsule}><span>{day}</span></div> : null
        return [capsule, <MessageBubble key={id} id={id} onRetry={onRetry} />]
      })}
    </div>
  )
}
