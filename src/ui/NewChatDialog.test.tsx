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
