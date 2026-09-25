// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { appStore, initialState } from '../../../store/store'
import { MessageBubble } from './MessageBubble'
import styles from './MessageBubble.module.css'

beforeEach(() => appStore.setState({ ...initialState }, true))

it('U6: обёрнут в React.memo (MessageList опирается на это, чтобы не перерисовывать все бабблы разом)', () => {
  expect(MessageBubble.$$typeof).toBe(Symbol.for('react.memo'))
})

it('failed local-* сообщение показывает «Повторить» и зовёт onRetry', async () => {
  appStore.setState({
    messagesById: { 'local-1': { id: 'local-1', chatId: 'c', direction: 'out', text: 'hi', timestamp: 0, status: 'failed' } },
  })
  const user = userEvent.setup()
  const onRetry = vi.fn()
  render(<MessageBubble id="local-1" onRetry={onRetry} />)
  await user.click(screen.getByRole('button', { name: 'Повторить' }))
  expect(onRetry).toHaveBeenCalledWith('local-1')
})

it('failed уже отправленное (не local-*) сообщение не показывает «Повторить» — сервер сам сообщил о недоставке', () => {
  appStore.setState({
    messagesById: { m1: { id: 'm1', chatId: 'c', direction: 'out', text: 'hi', timestamp: 0, status: 'failed' } },
  })
  render(<MessageBubble id="m1" onRetry={vi.fn()} />)
  expect(screen.queryByRole('button', { name: 'Повторить' })).not.toBeInTheDocument()
})

it('текст рендерится как текст, не как HTML', () => {
  appStore.setState({
    messagesById: { y: { id: 'y', chatId: 'c', direction: 'in', text: '<img src=x onerror=alert(1)>', timestamp: 0, status: 'sent' } },
  })
  const { container } = render(<MessageBubble id="y" onRetry={vi.fn()} />)
  expect(container.querySelector('img')).toBeNull()
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
})

it('медиа с подписью: метка и подпись — отдельные строки', () => {
  appStore.setState({
    messagesById: { m: { id: 'm', chatId: 'c', direction: 'in', text: 'Отпуск', mediaLabel: '📷 Фото', timestamp: 0, status: 'sent' } },
  })
  render(<MessageBubble id="m" onRetry={vi.fn()} />)
  expect(screen.getByText('📷 Фото')).toBeInTheDocument()
  expect(screen.getByText('Отпуск')).toBeInTheDocument()
})

it('медиа без подписи: только метка, без пустой строки текста', () => {
  appStore.setState({
    messagesById: { m: { id: 'm', chatId: 'c', direction: 'in', text: '', mediaLabel: '🎥 Видео', timestamp: 0, status: 'sent' } },
  })
  const { container } = render(<MessageBubble id="m" onRetry={vi.fn()} />)
  expect(screen.getByText('🎥 Видео')).toBeInTheDocument()
  expect(container.querySelector(`.${styles.text}`)).toBeNull()
})

it('удалённое сообщение показывает «Сообщение удалено» вместо текста', () => {
  appStore.setState({
    messagesById: { d: { id: 'd', chatId: 'c', direction: 'in', text: '', mediaLabel: '📷 Фото', deleted: true, timestamp: 0, status: 'sent' } },
  })
  render(<MessageBubble id="d" onRetry={vi.fn()} />)
  expect(screen.getByText('Сообщение удалено')).toBeInTheDocument()
  expect(screen.queryByText('📷 Фото')).toBeNull()
})

it('цитата от собеседника: автор — имя чата, строка — текст цитаты', () => {
  appStore.setState({
    chats: { c: { chatId: 'c', phone: '79990000000', title: 'Анна', historyLoaded: true } },
    messagesById: {
      x: {
        id: 'x', chatId: 'c', direction: 'in', text: 'А, ну вот оно', timestamp: 0, status: 'sent',
        quote: { id: 'q1', text: 'Работает?', fromMe: false },
      },
    },
  })
  render(<MessageBubble id="x" onRetry={vi.fn()} />)
  expect(screen.getByText('Анна')).toBeInTheDocument()
  expect(screen.getByText('Работает?')).toBeInTheDocument()
})

it('цитата своего сообщения: автор — «Вы»', () => {
  appStore.setState({
    chats: { c: { chatId: 'c', phone: '79990000000', title: 'Анна', historyLoaded: true } },
    messagesById: {
      x: { id: 'x', chatId: 'c', direction: 'out', text: 'да', timestamp: 0, status: 'sent', quote: { id: 'q1', text: 'Работает?', fromMe: true } },
    },
  })
  render(<MessageBubble id="x" onRetry={vi.fn()} />)
  expect(screen.getByText('Вы')).toBeInTheDocument()
})

it('цитата медиа-сообщения: строка цитаты — mediaLabel, а не текст', () => {
  appStore.setState({
    chats: { c: { chatId: 'c', phone: '79990000000', title: 'Анна', historyLoaded: true } },
    messagesById: {
      x: {
        id: 'x', chatId: 'c', direction: 'in', text: 'да', timestamp: 0, status: 'sent',
        quote: { id: 'q1', text: 'Момент', mediaLabel: '📷 Фото', fromMe: false },
      },
    },
  })
  render(<MessageBubble id="x" onRetry={vi.fn()} />)
  expect(screen.getByText('📷 Фото')).toBeInTheDocument()
})

it('цитируемое сообщение есть в сторе — показывается его актуальный текст, а не замороженный в quote', () => {
  appStore.setState({
    chats: { c: { chatId: 'c', phone: '79990000000', title: 'Анна', historyLoaded: true } },
    messagesById: {
      q1: { id: 'q1', chatId: 'c', direction: 'in', text: 'отредактированный вопрос', timestamp: -1, status: 'sent' },
      x: {
        id: 'x', chatId: 'c', direction: 'in', text: 'да', timestamp: 0, status: 'sent',
        quote: { id: 'q1', text: 'старый вопрос', fromMe: false },
      },
    },
  })
  render(<MessageBubble id="x" onRetry={vi.fn()} />)
  expect(screen.getByText('отредактированный вопрос')).toBeInTheDocument()
  expect(screen.queryByText('старый вопрос')).toBeNull()
})

it('удалённое сообщение не показывает цитату', () => {
  appStore.setState({
    chats: { c: { chatId: 'c', phone: '79990000000', title: 'Анна', historyLoaded: true } },
    messagesById: {
      x: {
        id: 'x', chatId: 'c', direction: 'in', text: '', deleted: true, timestamp: 0, status: 'sent',
        quote: { id: 'q1', text: 'Работает?', fromMe: false },
      },
    },
  })
  render(<MessageBubble id="x" onRetry={vi.fn()} />)
  expect(screen.queryByText('Работает?')).toBeNull()
})

it('text совпадает с mediaLabel (устаревшие данные) — трактуется как отсутствие подписи, без дублирования', () => {
  appStore.setState({
    messagesById: { m: { id: 'm', chatId: 'c', direction: 'in', text: '📷 Фото', mediaLabel: '📷 Фото', timestamp: 0, status: 'sent' } },
  })
  const { container } = render(<MessageBubble id="m" onRetry={vi.fn()} />)
  expect(screen.getAllByText('📷 Фото')).toHaveLength(1)
  expect(container.querySelector(`.${styles.text}`)).toBeNull()
})

it('отредактированное сообщение показывает «ред.» перед временем', () => {
  appStore.setState({
    messagesById: { e: { id: 'e', chatId: 'c', direction: 'in', text: 'привет', edited: true, timestamp: 0, status: 'sent' } },
  })
  render(<MessageBubble id="e" onRetry={vi.fn()} />)
  expect(screen.getByText('ред.')).toBeInTheDocument()
})
