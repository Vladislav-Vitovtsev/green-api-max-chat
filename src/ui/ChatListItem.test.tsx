// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { appStore, initialState } from '../store/store'
import { ChatListItem } from './ChatListItem'

beforeEach(() => {
  appStore.setState({ ...initialState }, true)
})

it('без сообщений превью показывает "Сообщений пока нет", а не заголовок чата', () => {
  appStore.setState((s) => ({
    chats: { ...s.chats, '1': { chatId: '1', phone: '79991234567', title: 'Иван Иванов', historyLoaded: true } },
    chatOrder: [...s.chatOrder, '1'],
  }))
  render(<ChatListItem chatId="1" active={false} onOpen={() => {}} />)
  expect(screen.getByText('Сообщений пока нет')).toBeInTheDocument()
  expect(screen.getAllByText('Иван Иванов')).toHaveLength(1)
})

it('превью медиа-сообщения с подписью: метка и подпись через пробел', () => {
  appStore.setState((s) => ({
    chats: { ...s.chats, '2': { chatId: '2', phone: '79991234568', title: 'Пётр Петров', historyLoaded: true } },
    chatOrder: [...s.chatOrder, '2'],
    messagesById: { ...s.messagesById, p1: { id: 'p1', chatId: '2', direction: 'in', text: 'Отпуск', mediaLabel: '📷 Фото', timestamp: 1, status: 'sent' } },
    orderByChat: { ...s.orderByChat, '2': ['p1'] },
  }))
  render(<ChatListItem chatId="2" active={false} onOpen={() => {}} />)
  expect(screen.getByText('📷 Фото Отпуск')).toBeInTheDocument()
})

it('превью медиа-сообщения без подписи: только метка', () => {
  appStore.setState((s) => ({
    chats: { ...s.chats, '3': { chatId: '3', phone: '79991234569', title: 'Анна Иванова', historyLoaded: true } },
    chatOrder: [...s.chatOrder, '3'],
    messagesById: { ...s.messagesById, p2: { id: 'p2', chatId: '3', direction: 'in', text: '', mediaLabel: '🎥 Видео', timestamp: 1, status: 'sent' } },
    orderByChat: { ...s.orderByChat, '3': ['p2'] },
  }))
  render(<ChatListItem chatId="3" active={false} onOpen={() => {}} />)
  expect(screen.getByText('🎥 Видео')).toBeInTheDocument()
})

it('превью медиа: text совпадает с mediaLabel (устаревшие данные) — без дублирования подписи', () => {
  appStore.setState((s) => ({
    chats: { ...s.chats, '3b': { chatId: '3b', phone: '79991234572', title: 'Иван Петров', historyLoaded: true } },
    chatOrder: [...s.chatOrder, '3b'],
    messagesById: { ...s.messagesById, p2b: { id: 'p2b', chatId: '3b', direction: 'in', text: '📷 Фото', mediaLabel: '📷 Фото', timestamp: 1, status: 'sent' } },
    orderByChat: { ...s.orderByChat, '3b': ['p2b'] },
  }))
  render(<ChatListItem chatId="3b" active={false} onOpen={() => {}} />)
  expect(screen.getByText('📷 Фото')).toBeInTheDocument()
})

it('превью удалённого сообщения показывает «Сообщение удалено», а не пустую строку', () => {
  appStore.setState((s) => ({
    chats: { ...s.chats, '4': { chatId: '4', phone: '79991234570', title: 'Олег Сидоров', historyLoaded: true } },
    chatOrder: [...s.chatOrder, '4'],
    messagesById: { ...s.messagesById, p3: { id: 'p3', chatId: '4', direction: 'in', text: '', deleted: true, timestamp: 1, status: 'sent' } },
    orderByChat: { ...s.orderByChat, '4': ['p3'] },
  }))
  render(<ChatListItem chatId="4" active={false} onOpen={() => {}} />)
  expect(screen.getByText('Сообщение удалено')).toBeInTheDocument()
})

it('непрочитанные > 0 показывают бейдж с числом и aria-label', () => {
  appStore.setState((s) => ({
    chats: { ...s.chats, '6': { chatId: '6', phone: '79991234573', title: 'Ольга Смирнова', historyLoaded: true, serverUnread: 3 } },
    chatOrder: [...s.chatOrder, '6'],
  }))
  render(<ChatListItem chatId="6" active={false} onOpen={() => {}} />)
  expect(screen.getByText('3')).toBeInTheDocument()
  expect(screen.getByRole('img', { name: '3 непрочитанных' })).toBeInTheDocument()
})

it('непрочитанных нет - бейдж скрыт', () => {
  appStore.setState((s) => ({
    chats: {
      ...s.chats,
      '7': { chatId: '7', phone: '79991234574', title: 'Без бейджа', historyLoaded: true, serverUnread: 0 },
      '8': { chatId: '8', phone: '79991234575', title: 'Тоже без бейджа', historyLoaded: true },
    },
    chatOrder: [...s.chatOrder, '7', '8'],
  }))
  const { rerender } = render(<ChatListItem chatId="7" active={false} onOpen={() => {}} />)
  expect(screen.queryByLabelText(/непрочитанных/)).not.toBeInTheDocument()
  rerender(<ChatListItem chatId="8" active={false} onOpen={() => {}} />)
  expect(screen.queryByLabelText(/непрочитанных/)).not.toBeInTheDocument()
})

it('больше 99 непрочитанных - «99+», aria-label с точным числом', () => {
  appStore.setState((s) => ({
    chats: { ...s.chats, '9': { chatId: '9', phone: '79991234576', title: 'Много непрочитанных', historyLoaded: true, serverUnread: 150 } },
    chatOrder: [...s.chatOrder, '9'],
  }))
  render(<ChatListItem chatId="9" active={false} onOpen={() => {}} />)
  expect(screen.getByText('99+')).toBeInTheDocument()
  expect(screen.getByLabelText('150 непрочитанных')).toBeInTheDocument()
})

it('превью своего удалённого сообщения: префикс «Вы: » сохраняется', () => {
  appStore.setState((s) => ({
    chats: { ...s.chats, '5': { chatId: '5', phone: '79991234571', title: 'Мария Кузнецова', historyLoaded: true } },
    chatOrder: [...s.chatOrder, '5'],
    messagesById: { ...s.messagesById, p4: { id: 'p4', chatId: '5', direction: 'out', text: '', deleted: true, timestamp: 1, status: 'sent' } },
    orderByChat: { ...s.orderByChat, '5': ['p4'] },
  }))
  render(<ChatListItem chatId="5" active={false} onOpen={() => {}} />)
  expect(screen.getByText('Вы: Сообщение удалено')).toBeInTheDocument()
})
