// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { actions } from '../store/actions'
import { appStore, initialState } from '../store/store'
import { ChatList } from './ChatList'

beforeEach(() => {
  appStore.setState({ ...initialState }, true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

it('валидный неизвестный номер — строка видна, клик создаёт чат и очищает поиск', async () => {
  const user = userEvent.setup()
  const createChat = vi.spyOn(actions, 'createChat').mockResolvedValue({ ok: true, chatId: '1' })
  render(<ChatList />)

  await user.type(screen.getByPlaceholderText('Найти'), '89991234567')
  const row = screen.getByRole('button', { name: 'Написать +7 999 123-45-67' })
  expect(row).toBeInTheDocument()

  await user.click(row)
  expect(createChat).toHaveBeenCalledWith('89991234567')
  const search = screen.getByPlaceholderText('Найти')
  await waitFor(() => expect(search).toHaveValue(''))
  // Строка «Написать» (где был фокус) пропадает из DOM вместе с очисткой query — без явного
  // переноса фокус провалился бы в document.body.
  await waitFor(() => expect(search).toHaveFocus())
})

it('во время создания строка задизейблена', async () => {
  const user = userEvent.setup()
  let resolve!: (r: { ok: true; chatId: string }) => void
  vi.spyOn(actions, 'createChat').mockReturnValue(new Promise((r) => { resolve = r }))
  render(<ChatList />)

  await user.type(screen.getByPlaceholderText('Найти'), '89991234567')
  const row = screen.getByRole('button', { name: 'Написать +7 999 123-45-67' })
  await user.click(row)
  expect(row).toBeDisabled()

  resolve({ ok: true, chatId: '1' })
  await waitFor(() => expect(screen.getByPlaceholderText('Найти')).toHaveValue(''))
})

it('номер существующего чата — строка скрыта, чат виден в списке', async () => {
  const user = userEvent.setup()
  appStore.setState((s) => ({
    chats: { ...s.chats, '1': { chatId: '1', phone: '79991234567', title: 'Иван Иванов', historyLoaded: true } },
    chatOrder: [...s.chatOrder, '1'],
  }))
  render(<ChatList />)

  await user.type(screen.getByPlaceholderText('Найти'), '+7 999 123-45-67')
  expect(screen.queryByRole('button', { name: /Написать/ })).not.toBeInTheDocument()
  expect(screen.getByText('Иван Иванов')).toBeInTheDocument()
})

it('noAccount — под строкой показывается «У этого номера нет MAX»', async () => {
  const user = userEvent.setup()
  vi.spyOn(actions, 'createChat').mockResolvedValue({ ok: false, error: 'noAccount' })
  render(<ChatList />)

  await user.type(screen.getByPlaceholderText('Найти'), '89991234567')
  await user.click(screen.getByRole('button', { name: 'Написать +7 999 123-45-67' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('У этого номера нет MAX')
})

it('rateLimit — под строкой текст про ограничение проверки номеров', async () => {
  const user = userEvent.setup()
  vi.spyOn(actions, 'createChat').mockResolvedValue({ ok: false, error: 'rateLimit' })
  render(<ChatList />)

  await user.type(screen.getByPlaceholderText('Найти'), '89991234567')
  await user.click(screen.getByRole('button', { name: 'Написать +7 999 123-45-67' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('ограничил проверку номеров')
})

it('невалидная строка поиска — строки нет', async () => {
  const user = userEvent.setup()
  render(<ChatList />)
  await user.type(screen.getByPlaceholderText('Найти'), 'Иван')
  expect(screen.queryByRole('button', { name: /Написать/ })).not.toBeInTheDocument()
})
