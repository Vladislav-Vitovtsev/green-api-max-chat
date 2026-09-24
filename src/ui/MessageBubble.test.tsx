// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { appStore, initialState } from '../store/store'
import { MessageBubble } from './MessageBubble'

beforeEach(() => appStore.setState({ ...initialState }, true))

it('failed показывает «Повторить» и зовёт onRetry', async () => {
  appStore.setState({
    messagesById: { x: { id: 'x', chatId: 'c', direction: 'out', text: 'hi', timestamp: 0, status: 'failed' } },
  })
  const user = userEvent.setup()
  const onRetry = vi.fn()
  render(<MessageBubble id="x" onRetry={onRetry} />)
  await user.click(screen.getByRole('button', { name: 'Повторить' }))
  expect(onRetry).toHaveBeenCalledWith('x')
})

it('текст рендерится как текст, не как HTML', () => {
  appStore.setState({
    messagesById: { y: { id: 'y', chatId: 'c', direction: 'in', text: '<img src=x onerror=alert(1)>', timestamp: 0, status: 'sent' } },
  })
  const { container } = render(<MessageBubble id="y" onRetry={vi.fn()} />)
  expect(container.querySelector('img')).toBeNull()
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
})
