// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../../api/errors/errors'
import { LoginScreen } from './LoginScreen'

it('отправляет креды и показывает ошибку по kind', async () => {
  const user = userEvent.setup()
  const onLogin = vi.fn().mockRejectedValueOnce(new ApiError('unauthorized')).mockResolvedValueOnce(undefined)
  render(<LoginScreen onLogin={onLogin} />)
  await user.type(screen.getByLabelText('idInstance'), '3100')
  await user.type(screen.getByLabelText('apiTokenInstance'), 'tok')
  await user.click(screen.getByRole('button', { name: 'Войти' }))
  expect(onLogin).toHaveBeenCalledWith(
    { idInstance: '3100', apiTokenInstance: 'tok', apiUrl: 'https://api.green-api.com' },
    false,
  )
  expect(await screen.findByRole('alert')).toHaveTextContent('Неверный idInstance или apiTokenInstance')
})

it('токен скрыт по умолчанию', () => {
  render(<LoginScreen onLogin={vi.fn()} />)
  expect(screen.getByLabelText('apiTokenInstance')).toHaveAttribute('type', 'password')
})

it('кнопка неактивна, пока поля пусты', () => {
  render(<LoginScreen onLogin={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'Войти' })).toBeDisabled()
})

it('блокирует форму, пока идёт вход', async () => {
  const user = userEvent.setup()
  let resolveLogin: () => void = () => {}
  const onLogin = vi.fn(() => new Promise<void>((resolve) => { resolveLogin = resolve }))
  render(<LoginScreen onLogin={onLogin} />)
  await user.type(screen.getByLabelText('idInstance'), '3100')
  await user.type(screen.getByLabelText('apiTokenInstance'), 'tok')
  await user.click(screen.getByRole('button', { name: 'Войти' }))
  expect(screen.getByLabelText('idInstance')).toBeDisabled()
  expect(screen.getByRole('checkbox')).toBeDisabled()
  resolveLogin()
  await waitFor(() => expect(screen.getByLabelText('idInstance')).not.toBeDisabled())
})

it('после отклонённого входа показывает ошибку и снова разблокирует поля', async () => {
  const user = userEvent.setup()
  const onLogin = vi.fn().mockRejectedValueOnce(new ApiError('unauthorized'))
  render(<LoginScreen onLogin={onLogin} />)
  await user.type(screen.getByLabelText('idInstance'), '3100')
  await user.type(screen.getByLabelText('apiTokenInstance'), 'tok')
  await user.click(screen.getByRole('button', { name: 'Войти' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Неверный idInstance или apiTokenInstance')
  expect(screen.getByLabelText('idInstance')).not.toBeDisabled()
  expect(screen.getByRole('checkbox')).not.toBeDisabled()
})

it('обрезает пробелы вокруг значений перед отправкой', async () => {
  const user = userEvent.setup()
  const onLogin = vi.fn().mockResolvedValueOnce(undefined)
  render(<LoginScreen onLogin={onLogin} />)
  await user.type(screen.getByLabelText('idInstance'), '  3100  ')
  await user.type(screen.getByLabelText('apiTokenInstance'), 'tok')
  await user.click(screen.getByRole('button', { name: 'Войти' }))
  expect(onLogin).toHaveBeenCalledWith(
    { idInstance: '3100', apiTokenInstance: 'tok', apiUrl: 'https://api.green-api.com' },
    false,
  )
})
