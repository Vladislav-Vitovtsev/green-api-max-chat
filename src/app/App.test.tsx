// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeLocks } from '../test/fakeLocks'

async function freshApp() {
  vi.resetModules()
  const { actions } = await import('../store/actions/actions')
  const { App } = await import('./App')
  return { actions, App }
}

let stop: () => void = () => {}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})

afterEach(() => {
  stop()
  vi.unstubAllGlobals()
})

function stubFetch() {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('getStateInstance')) return new Response('{"stateInstance":"authorized"}')
    if (url.includes('receiveNotification')) return new Promise<Response>(() => {})
    return new Response('null')
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

it('без кредов — экран входа, после входа — список чатов', async () => {
  const user = userEvent.setup()
  stubFetch()
  const { actions, App } = await freshApp()
  stop = actions.logout

  render(<App />)
  await user.type(await screen.findByLabelText('idInstance'), '3100')
  await user.type(screen.getByLabelText('apiTokenInstance'), 'tok')
  await user.click(screen.getByRole('button', { name: 'Войти' }))

  expect(await screen.findByRole('heading', { name: 'Чаты' })).toBeInTheDocument()
  expect(screen.getByText('Выберите чат или создайте новый')).toBeInTheDocument()
})

it('лок занят другой вкладкой — экран «открыто в другой вкладке» без restore и сети; «Работать здесь» восстанавливает сессию', async () => {
  const user = userEvent.setup()
  const fetchMock = stubFetch()
  localStorage.setItem(
    'max-chat:credentials',
    JSON.stringify({ apiUrl: 'https://api.green-api.com', idInstance: '3100', apiTokenInstance: 'tok' }),
  )
  const locks = fakeLocks()
  locks.request('max-chat:active-tab', { mode: 'exclusive' }, () => new Promise(() => {})).catch(() => {})
  vi.stubGlobal('navigator', { ...navigator, locks })
  const { actions, App } = await freshApp()
  stop = actions.stop

  render(<App />)
  expect(await screen.findByText('Приложение открыто в другой вкладке', {}, { timeout: 3000 })).toBeInTheDocument()
  expect(fetchMock).not.toHaveBeenCalled()
  expect(screen.queryByLabelText('idInstance')).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Работать здесь' }))

  expect(await screen.findByRole('heading', { name: 'Чаты' })).toBeInTheDocument()
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('receiveNotification'), expect.anything()))
})
