// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Composer } from './Composer'

it('Enter отправляет и очищает, Shift+Enter — перенос', async () => {
  const user = userEvent.setup()
  const onSend = vi.fn()
  render(<Composer onSend={onSend} />)
  const box = screen.getByPlaceholderText('Сообщение')
  await user.type(box, 'раз{Shift>}{Enter}{/Shift}два')
  expect(onSend).not.toHaveBeenCalled()
  await user.type(box, '{Enter}')
  expect(onSend).toHaveBeenCalledWith('раз\nдва')
  expect(box).toHaveValue('')
})

it('кнопка отправки видна только с текстом; > 4000 символов блокирует', async () => {
  const user = userEvent.setup()
  const onSend = vi.fn()
  render(<Composer onSend={onSend} />)
  expect(screen.queryByRole('button', { name: 'Отправить' })).toBeNull()
  const box = screen.getByPlaceholderText('Сообщение')
  await user.click(box)
  await user.paste('x'.repeat(4001))
  expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled()
  expect(screen.getByText('Слишком длинное сообщение: 4001 из 4000')).toBeInTheDocument()
  await user.type(box, '{Enter}')
  expect(onSend).not.toHaveBeenCalled()
})
