// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { appStore } from '../store/store'
import { ChatListItem } from './ChatListItem'

it('без сообщений превью показывает "Сообщений пока нет", а не заголовок чата', () => {
  appStore.setState((s) => ({
    chats: { ...s.chats, '1': { chatId: '1', phone: '79991234567', title: 'Иван Иванов', historyLoaded: true } },
    chatOrder: [...s.chatOrder, '1'],
  }))
  render(<ChatListItem chatId="1" active={false} onOpen={() => {}} />)
  expect(screen.getByText('Сообщений пока нет')).toBeInTheDocument()
  expect(screen.getAllByText('Иван Иванов')).toHaveLength(1)
})
