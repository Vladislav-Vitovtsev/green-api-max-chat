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

it('капсула дня лежит в одной секции со своими сообщениями, чтобы липнуть только в пределах дня', () => {
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
  const yesterdaySection = screen.getByText('Вчера').closest('section')
  const todaySection = screen.getByText('Сегодня').closest('section')
  expect(yesterdaySection).not.toBe(todaySection)
  expect(yesterdaySection).toHaveTextContent('первое')
  expect(yesterdaySection).not.toHaveTextContent('второе')
  expect(todaySection).toHaveTextContent('второе')
})
