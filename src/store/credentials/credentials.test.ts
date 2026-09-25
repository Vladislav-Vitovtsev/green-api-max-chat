// @vitest-environment jsdom
import { clearCredentials, loadCredentials, saveCredentials } from './credentials'

const c = { apiUrl: 'https://api.green-api.com', idInstance: '1', apiTokenInstance: 't' }

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

it('без «запомнить» — только sessionStorage', () => {
  saveCredentials(c, false)
  expect(sessionStorage.getItem('max-chat:credentials')).not.toBeNull()
  expect(localStorage.getItem('max-chat:credentials')).toBeNull()
  expect(loadCredentials()).toEqual({ creds: c, remember: false })
})

it('с «запомнить» — localStorage', () => {
  saveCredentials(c, true)
  expect(localStorage.getItem('max-chat:credentials')).not.toBeNull()
  expect(loadCredentials()).toEqual({ creds: c, remember: true })
})

it('clear чистит оба хранилища, битый JSON → null', () => {
  saveCredentials(c, true)
  clearCredentials()
  expect(loadCredentials()).toBeNull()
  sessionStorage.setItem('max-chat:credentials', '{bad')
  expect(loadCredentials()).toBeNull()
})

it('remember=true при уже сохранённых кредах не трогает localStorage.removeItem — только setItem', () => {
  saveCredentials(c, true)
  const removeSpy = vi.spyOn(localStorage, 'removeItem')
  saveCredentials(c, true)
  expect(removeSpy).not.toHaveBeenCalledWith('max-chat:credentials')
  removeSpy.mockRestore()
})
