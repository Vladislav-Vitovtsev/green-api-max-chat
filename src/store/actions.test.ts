import type { StateStorage } from 'zustand/middleware'
import type { GreenApi } from '../api/greenApi'
import { ApiError } from '../api/errors'
import type { RawHistoryItem } from '../api/types'
import { createActions } from './actions'
import { createAppStore, type AppStore } from './store'

const creds = { apiUrl: 'https://api.green-api.com', idInstance: '1', apiTokenInstance: 't' }

function hangUntilAbort(_t: number, signal?: AbortSignal) {
  return new Promise<null>((_, reject) =>
    signal?.addEventListener('abort', () => reject(new DOMException('a', 'AbortError'))),
  )
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function fakeApi(over: Partial<GreenApi> = {}): GreenApi {
  return {
    getStateInstance: vi.fn(async () => 'authorized'),
    sendMessage: vi.fn(async () => ({ idMessage: 'm1' })),
    getChatHistory: vi.fn(async () => []),
    checkAccount: vi.fn(async () => ({ exist: true, chatId: '10000001' })),
    receiveNotification: vi.fn(hangUntilAbort),
    deleteNotification: vi.fn(async () => {}),
    ...over,
  }
}

function setup(api = fakeApi()) {
  const store: AppStore = createAppStore({ getItem: () => null, setItem: () => {}, removeItem: () => {} })
  const saved: unknown[] = []
  let n = 0
  const actions = createActions({
    store,
    makeApi: () => api,
    locks: null,
    uuid: () => `u${++n}`,
    now: () => 1_000,
    creds: { load: () => null, save: (...a) => void saved.push(a), clear: () => {} },
  })
  return { store, actions, api, saved }
}

describe('login', () => {
  it('authorized → креды в store и сохранены, опрос запущен', async () => {
    const t = setup()
    await t.actions.login(creds, true)
    expect(t.store.getState().credentials).toEqual(creds)
    expect(t.saved).toEqual([[creds, true]])
    expect(t.api.receiveNotification).toHaveBeenCalled()
    t.actions.logout()
  })

  it('не authorized → ApiError notAuthorized, ничего не сохраняем', async () => {
    const t = setup(fakeApi({ getStateInstance: vi.fn(async () => 'notAuthorized') }))
    await expect(t.actions.login(creds, false)).rejects.toMatchObject({ kind: 'notAuthorized' })
    expect(t.store.getState().credentials).toBeNull()
    expect(t.saved).toEqual([])
  })
})

describe('createChat', () => {
  it('валидирует номер до сети', async () => {
    const t = setup()
    await t.actions.login(creds, false)
    await expect(t.actions.createChat('+382 67 123 456')).resolves.toEqual({ ok: false, error: 'country' })
    expect(t.api.checkAccount).not.toHaveBeenCalled()
    t.actions.logout()
  })

  it('нет MAX → noAccount', async () => {
    const t = setup(fakeApi({ checkAccount: vi.fn(async () => ({ exist: false, chatId: '' })) }))
    await t.actions.login(creds, false)
    await expect(t.actions.createChat('79991234567')).resolves.toEqual({ ok: false, error: 'noAccount' })
    t.actions.logout()
  })

  it('создаёт чат с числовым chatId, открывает и грузит историю', async () => {
    const t = setup()
    await t.actions.login(creds, false)
    await expect(t.actions.createChat('8 999 123-45-67')).resolves.toEqual({ ok: true, chatId: '10000001' })
    const s = t.store.getState()
    expect(s.chats['10000001']).toMatchObject({ phone: '79991234567', title: '+7 999 123-45-67', historyLoaded: true })
    expect(s.activeChatId).toBe('10000001')
    expect(t.api.getChatHistory).toHaveBeenCalledWith('10000001', 100, expect.anything())
    t.actions.logout()
  })

  it('повторный номер открывает существующий чат без checkAccount', async () => {
    const t = setup()
    await t.actions.login(creds, false)
    await t.actions.createChat('79991234567')
    await t.actions.createChat('+7 999 123 45 67')
    expect(t.api.checkAccount).toHaveBeenCalledTimes(1)
    t.actions.logout()
  })
})

describe('sendMessage', () => {
  it('pending → sent с серверным id', async () => {
    const t = setup()
    await t.actions.login(creds, false)
    await t.actions.createChat('79991234567')
    await t.actions.sendMessage('10000001', '  привет  ')
    const s = t.store.getState()
    expect(s.orderByChat['10000001']).toEqual(['m1'])
    expect(s.messagesById.m1).toMatchObject({ text: 'привет', status: 'sent', direction: 'out' })
    t.actions.logout()
  })

  it('ошибка → failed, без автоповтора; retry отправляет заново', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const send = vi.fn().mockRejectedValueOnce(new ApiError('network')).mockResolvedValueOnce({ idMessage: 'm2' })
    const t = setup(fakeApi({ sendMessage: send }))
    await t.actions.login(creds, false)
    await t.actions.createChat('79991234567')
    await t.actions.sendMessage('10000001', 'раз')
    expect(send).toHaveBeenCalledTimes(1)
    const failedId = t.store.getState().orderByChat['10000001']![0]!
    expect(t.store.getState().messagesById[failedId]!.status).toBe('failed')
    await t.actions.retryMessage(failedId)
    expect(t.store.getState().orderByChat['10000001']).toEqual(['m2'])
    t.actions.logout()
    warn.mockRestore()
  })

  it('пустой текст и > 4000 символов не отправляются', async () => {
    const t = setup()
    await t.actions.login(creds, false)
    await t.actions.createChat('79991234567')
    await t.actions.sendMessage('10000001', '   ')
    await t.actions.sendMessage('10000001', 'x'.repeat(4001))
    expect(t.api.sendMessage).not.toHaveBeenCalled()
    t.actions.logout()
  })

  it('чат не создан в сторе → тихо ничего не делает, без падения', async () => {
    const t = setup()
    await t.actions.login(creds, false)
    await expect(t.actions.sendMessage('нет-такого-чата', 'привет')).resolves.toBeUndefined()
    expect(t.api.sendMessage).not.toHaveBeenCalled()
    expect(t.store.getState().messagesById).toEqual({})
    t.actions.logout()
  })
})

describe('generation guard: устаревшие ответы после logout/relogin не трогают стор', () => {
  it('checkAccount, разрешившийся после logout, не создаёт чат', async () => {
    const d = deferred<{ exist: boolean; chatId: string }>()
    const t = setup(fakeApi({ checkAccount: vi.fn(() => d.promise) }))
    await t.actions.login(creds, false)
    const p = t.actions.createChat('79991234567')
    t.actions.logout()
    d.resolve({ exist: true, chatId: '10000001' })
    await expect(p).resolves.toEqual({ ok: false, error: 'unauthorized' })
    const s = t.store.getState()
    expect(s.chats).toEqual({})
    expect(s.activeChatId).toBeNull()
  })

  it('getChatHistory, разрешившийся после logout, не пишет сообщения и не ставит historyError', async () => {
    const d = deferred<RawHistoryItem[]>()
    const getChatHistory = vi
      .fn(async () => [] as RawHistoryItem[])
      .mockImplementationOnce(async () => [])
      .mockImplementationOnce(() => d.promise)
    const t = setup(fakeApi({ getChatHistory }))
    await t.actions.login(creds, false)
    await t.actions.createChat('79991234567')
    const p = t.actions.reloadHistory('10000001')
    t.actions.logout()
    d.resolve([])
    await p
    const s = t.store.getState()
    expect(s.historyError).toEqual({})
    expect(s.messagesById).toEqual({})
  })

  it('после logout + повторного login (новое поколение) устаревший ответ игнорируется', async () => {
    const d = deferred<RawHistoryItem[]>()
    const getChatHistory = vi
      .fn(async () => [] as RawHistoryItem[])
      .mockImplementationOnce(async () => [])
      .mockImplementationOnce(() => d.promise)
    const t = setup(fakeApi({ getChatHistory }))
    await t.actions.login(creds, false)
    await t.actions.createChat('79991234567')
    const p = t.actions.reloadHistory('10000001')
    t.actions.logout()
    await t.actions.login(creds, false)
    d.resolve([])
    await p
    const s = t.store.getState()
    expect(s.historyError).toEqual({})
    expect(s.messagesById).toEqual({})
    t.actions.logout()
  })
})

describe('ownerId — персист принадлежит инстансу', () => {
  function makeStorage(): StateStorage {
    const m = new Map<string, string>()
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }
  }

  function actionsOn(store: AppStore, api: GreenApi = fakeApi()) {
    return createActions({
      store,
      makeApi: () => api,
      locks: null,
      creds: { load: () => null, save: () => {}, clear: () => {} },
    })
  }

  async function seedInstance1(storage: StateStorage): Promise<void> {
    const store = createAppStore(storage)
    const a = actionsOn(store)
    await a.login({ ...creds, idInstance: '1' }, false)
    await a.createChat('79991234567')
    a.stop()
  }

  it('логин под другим idInstance сбрасывает чужие персистированные чаты', async () => {
    const storage = makeStorage()
    await seedInstance1(storage)

    const store2 = createAppStore(storage)
    expect(store2.getState().chats['10000001']).toBeDefined()
    const a2 = actionsOn(store2)
    await a2.login({ ...creds, idInstance: '2' }, false)
    expect(store2.getState().chats).toEqual({})
    a2.stop()
  })

  it('повторный логин под тем же idInstance сохраняет данные', async () => {
    const storage = makeStorage()
    await seedInstance1(storage)

    const store2 = createAppStore(storage)
    const a2 = actionsOn(store2)
    await a2.login({ ...creds, idInstance: '1' }, false)
    expect(store2.getState().chats['10000001']).toBeDefined()
    a2.stop()
  })
})

describe('опрос и logout', () => {
  it('401 из опроса → logout с authError unauthorized', async () => {
    const t = setup(fakeApi({ receiveNotification: vi.fn(async () => Promise.reject(new ApiError('unauthorized'))) }))
    await t.actions.login(creds, false)
    await vi.waitFor(() => expect(t.store.getState().authError).toBe('unauthorized'))
    expect(t.store.getState().credentials).toBeNull()
  })

  it('logout чистит всё', async () => {
    const t = setup()
    await t.actions.login(creds, false)
    await t.actions.createChat('79991234567')
    t.actions.logout()
    const s = t.store.getState()
    expect(s.credentials).toBeNull()
    expect(s.chats).toEqual({})
    expect(s.messagesById).toEqual({})
  })
})

describe('stop', () => {
  it('обрывает опрос, но не чистит креды и данные (R6)', async () => {
    const t = setup()
    await t.actions.login(creds, true)
    const [, signal] = vi.mocked(t.api.receiveNotification).mock.calls[0]!
    expect((signal as AbortSignal).aborted).toBe(false)
    t.actions.stop()
    expect((signal as AbortSignal).aborted).toBe(true)
    expect(t.store.getState().credentials).toEqual(creds)
  })
})
