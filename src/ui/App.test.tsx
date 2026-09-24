// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { actions } from '../store/actions'
import { appStore, initialState } from '../store/store'
import { App } from './App'

beforeEach(() => {
  appStore.setState({ ...initialState }, true)
  sessionStorage.clear()
  localStorage.clear()
})

afterEach(() => {
  // Опрос из receiveNotification никогда не резолвится сам — обрываем сессию,
  // иначе она держит тест живым после его завершения.
  actions.logout()
  vi.unstubAllGlobals()
})

it('без кредов — экран входа, после входа — список чатов', async () => {
  const user = userEvent.setup()
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('getStateInstance')) return new Response('{"stateInstance":"authorized"}')
    if (url.includes('receiveNotification')) return new Promise<Response>(() => {})
    return new Response('null')
  })
  vi.stubGlobal('fetch', fetchMock)

  render(<App />)
  await user.type(screen.getByLabelText('idInstance'), '3100')
  await user.type(screen.getByLabelText('apiTokenInstance'), 'tok')
  await user.click(screen.getByRole('button', { name: 'Войти' }))

  expect(await screen.findByRole('heading', { name: 'Чаты' })).toBeInTheDocument()
  expect(screen.getByText('Выберите чат или создайте новый')).toBeInTheDocument()
})
