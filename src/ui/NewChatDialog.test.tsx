// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewChatDialog } from './NewChatDialog'

it('показывает ошибку создания и не закрывается', async () => {
  const user = userEvent.setup()
  const onCreate = vi.fn(async () => ({ ok: false as const, error: 'noAccount' as const }))
  const onClose = vi.fn()
  render(<NewChatDialog onCreate={onCreate} onClose={onClose} />)
  await user.type(screen.getByLabelText('Номер телефона'), '79991234567')
  await user.click(screen.getByRole('button', { name: 'Создать чат' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('У этого номера нет MAX')
  expect(onClose).not.toHaveBeenCalled()
})

it('маска форматирует номер по мере ввода', async () => {
  const user = userEvent.setup()
  render(<NewChatDialog onCreate={vi.fn()} onClose={vi.fn()} />)
  await user.type(screen.getByLabelText('Номер телефона'), '89991234567')
  expect(screen.getByLabelText('Номер телефона')).toHaveValue('+7 999 123-45-67')
})

it('backspace на разделителе реально удаляет цифру, а не ничего', async () => {
  const user = userEvent.setup()
  render(<NewChatDialog onCreate={vi.fn()} onClose={vi.fn()} />)
  const input = screen.getByLabelText('Номер телефона') as HTMLInputElement
  await user.type(input, '89991234567')
  expect(input).toHaveValue('+7 999 123-45-67')
  const before = input.value.replace(/\D/g, '')

  // Каретка перед «1» в «+7 999 |123-45-67» — backspace должен стереть пробел-разделитель.
  input.setSelectionRange(7, 7)
  await user.keyboard('{Backspace}')

  const after = input.value.replace(/\D/g, '')
  expect(after.length).toBe(before.length - 1)
  expect(input.value).not.toBe('+7 999 123-45-67')
})

it('Delete (forward) на разделителе удаляет следующую цифру, а не предыдущую', async () => {
  const user = userEvent.setup()
  render(<NewChatDialog onCreate={vi.fn()} onClose={vi.fn()} />)
  const input = screen.getByLabelText('Номер телефона') as HTMLInputElement
  await user.type(input, '89991234567')
  expect(input).toHaveValue('+7 999 123-45-67')

  // Каретка перед дефисом в «+7 999 123|-45-67» — Delete должен стереть дефис-разделитель
  // и следующую за ним цифру «4», а не предыдущую «3».
  input.setSelectionRange(10, 10)
  await user.keyboard('{Delete}')

  expect(input).toHaveValue('+7 999 123-56-7')
})

it('paste, заменяющий выделение с тем же числом цифр, не путается с backspace', async () => {
  const user = userEvent.setup()
  render(<NewChatDialog onCreate={vi.fn()} onClose={vi.fn()} />)
  const input = screen.getByLabelText('Номер телефона') as HTMLInputElement
  await user.type(input, '89991234567')
  expect(input).toHaveValue('+7 999 123-45-67')

  // Выделяем «45-67» (4 цифры + разделитель) и вставляем «4567» (те же 4 цифры без разделителя) —
  // цифр столько же и строка короче, как при backspace/delete, но это paste — цифры трогать нельзя.
  input.setSelectionRange(11, 16)
  await user.paste('4567')

  expect(input).toHaveValue('+7 999 123-45-67')
})

it('успех закрывает диалог; Escape тоже закрывает', async () => {
  const user = userEvent.setup()
  const onCreate = vi.fn(async () => ({ ok: true as const, chatId: '1' }))
  const onClose = vi.fn()
  render(<NewChatDialog onCreate={onCreate} onClose={onClose} />)
  await user.type(screen.getByLabelText('Номер телефона'), '79991234567{Enter}')
  expect(onClose).toHaveBeenCalledTimes(1)
  await user.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalledTimes(2)
})

it('focus trap: Tab с последнего элемента уходит на первый, фон inert, закрытие возвращает фокус на «+»', async () => {
  const user = userEvent.setup()
  const plusButton = document.createElement('button')
  document.body.appendChild(plusButton)
  plusButton.focus()

  const { unmount } = render(<NewChatDialog onCreate={vi.fn()} onClose={vi.fn()} />)

  const input = screen.getByLabelText('Номер телефона') as HTMLInputElement
  await waitFor(() => expect(input).toHaveFocus())
  expect(plusButton.hasAttribute('inert')).toBe(true)

  await user.type(input, '79991234567')
  const cancel = screen.getByRole('button', { name: 'Отмена' })
  const submit = screen.getByRole('button', { name: 'Создать чат' })

  submit.focus()
  await user.tab()
  expect(input).toHaveFocus()

  input.focus()
  await user.tab({ shift: true })
  expect(submit).toHaveFocus()
  expect(cancel).toBeInTheDocument()

  unmount()
  expect(plusButton).toHaveFocus()
  expect(plusButton.hasAttribute('inert')).toBe(false)
  document.body.removeChild(plusButton)
})

it('Safari: если на открытии document.activeElement остался body (клик мышью не фокусирует кнопку), закрытие возвращает фокус на triggerRef, а не на body', async () => {
  const plusButton = document.createElement('button')
  document.body.appendChild(plusButton)
  // Специально НЕ фокусируем plusButton — так ведёт себя Safari без «Full Keyboard Access»:
  // клик мышью по кнопке не переводит на неё фокус, document.activeElement остаётся body.
  document.body.focus()
  expect(document.activeElement).toBe(document.body)

  const triggerRef = { current: plusButton as HTMLElement | null }
  const { unmount } = render(<NewChatDialog onCreate={vi.fn()} onClose={vi.fn()} triggerRef={triggerRef} />)

  const input = screen.getByLabelText('Номер телефона') as HTMLInputElement
  await waitFor(() => expect(input).toHaveFocus())

  unmount()
  expect(plusButton).toHaveFocus()
  document.body.removeChild(plusButton)
})

it('rateLimit показывает текст про ограничение проверки номеров', async () => {
  const user = userEvent.setup()
  const onCreate = vi.fn(async () => ({ ok: false as const, error: 'rateLimit' as const }))
  render(<NewChatDialog onCreate={onCreate} onClose={vi.fn()} />)
  await user.type(screen.getByLabelText('Номер телефона'), '79991234567{Enter}')
  expect(await screen.findByRole('alert')).toHaveTextContent('ограничил проверку номеров')
})

it('пока onCreate не завершился, Escape и клик по подложке не закрывают диалог', async () => {
  const user = userEvent.setup()
  let resolve!: (r: { ok: true; chatId: string }) => void
  const onCreate = vi.fn(() => new Promise<{ ok: true; chatId: string }>((r) => { resolve = r }))
  const onClose = vi.fn()
  const { container } = render(<NewChatDialog onCreate={onCreate} onClose={onClose} />)
  await user.type(screen.getByLabelText('Номер телефона'), '79991234567{Enter}')
  expect(onCreate).toHaveBeenCalledTimes(1)

  await user.keyboard('{Escape}')
  expect(onClose).not.toHaveBeenCalled()

  await user.click(container.firstChild as HTMLElement)
  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Отмена' })).toBeDisabled()

  resolve({ ok: true, chatId: '1' })
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
})
