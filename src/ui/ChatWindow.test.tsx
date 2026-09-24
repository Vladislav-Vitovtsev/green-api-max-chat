// @vitest-environment jsdom
import { act, fireEvent, render } from '@testing-library/react'
import { appStore, initialState } from '../store/store'
import { ChatWindow } from './ChatWindow'
import styles from './ChatWindow.module.css'

beforeEach(() => appStore.setState({ ...initialState }, true))

it('переключение чата открывает список внизу, даже если предыдущий чат был прокручен вверх', () => {
  const now = Date.now()
  appStore.setState({
    chats: {
      a: { chatId: 'a', phone: '79991111111', title: 'A', historyLoaded: true },
      b: { chatId: 'b', phone: '79992222222', title: 'B', historyLoaded: true },
    },
    chatOrder: ['a', 'b'],
    activeChatId: 'a',
    messagesById: {
      a1: { id: 'a1', chatId: 'a', direction: 'in', text: 'привет', timestamp: now, status: 'sent' },
      b1: { id: 'b1', chatId: 'b', direction: 'in', text: 'йо', timestamp: now, status: 'sent' },
    },
    orderByChat: { a: ['a1'], b: ['b1'] },
  })

  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, value: 1000 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 400 })

  const { container } = render(<ChatWindow />)
  const listEl = () => container.querySelector(`.${styles.messages}`) as HTMLDivElement

  // пользователь прокрутил список чата A вверх, далеко от низа
  listEl().scrollTop = 50
  fireEvent.scroll(listEl())

  act(() => {
    appStore.setState({ activeChatId: 'b' })
  })

  const bList = listEl()
  expect(bList.scrollTop).toBe(bList.scrollHeight)
})
