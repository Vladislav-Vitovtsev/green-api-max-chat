// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { appStore, initialState } from '../store/store'
import { MessageList } from './MessageList'

beforeEach(() => appStore.setState({ ...initialState }, true))

it('сообщения за разные дни разделены капсулами дат по порядку', () => {
  const now = Date.now()
  const yesterday = now - 24 * 60 * 60 * 1000
  appStore.setState({
    messagesById: {
      m1: { id: 'm1', chatId: 'c', direction: 'in', text: 'первое', timestamp: yesterday, status: 'sent' },
      m2: { id: 'm2', chatId: 'c', direction: 'in', text: 'второе', timestamp: now, status: 'sent' },
    },
    orderByChat: { c: ['m1', 'm2'] },
  })
  render(<MessageList chatId="c" />)
  const capsules = screen.getAllByText(/^(Вчера|Сегодня)$/)
  expect(capsules.map((el) => el.textContent)).toEqual(['Вчера', 'Сегодня'])
})
