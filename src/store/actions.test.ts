import type { StateStorage } from 'zustand/middleware'
import type { GreenApi } from '../api/greenApi'
import { ApiError } from '../api/errors'
import type { RawHistoryItem, RawNotification } from '../api/types'
import { fixtures } from '../core/__fixtures__/notifications'
import type { LocksLike } from '../core/tabLock'
import { fakeLocks } from '../test/fakeLocks'
import type { Message } from '../core/model'
import { createActions } from './actions'
import { reduceEvent } from './reduce'
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

  it('статус приходит по опросу, пока sendMessage ещё в полёте: буфер применяется при подтверждении', async () => {
    const d = deferred<{ idMessage: string }>()
    const t = setup(fakeApi({ sendMessage: vi.fn(() => d.promise) }))
    await t.actions.login(creds, false)
    await t.actions.createChat('79991234567')

    const p = t.actions.sendMessage('10000001', 'привет')
    // Статус для будущего idMessage 'm1' прилетает раньше, чем sendMessage успевает resolve'иться.
    t.store.setState(reduceEvent(t.store.getState(), { type: 'status', chatId: '10000001', idMessage: 'm1', status: 'delivered' }))
    expect(t.store.getState().pendingStatus.m1).toBe('delivered')

    d.resolve({ idMessage: 'm1' })
    await p

    const s = t.store.getState()
    expect(s.orderByChat['10000001']).toEqual(['m1'])
    expect(s.messagesById.m1!.status).toBe('delivered')
    expect(s.pendingStatus.m1).toBeUndefined()
    t.actions.logout()
  })

  it('эхо приходит по опросу, пока sendMessage ещё в полёте: local-* дедуплицируется с ним при подтверждении', async () => {
    const d = deferred<{ idMessage: string }>()
    const t = setup(fakeApi({ sendMessage: vi.fn(() => d.promise) }))
    await t.actions.login(creds, false)
    await t.actions.createChat('79991234567')

    const p = t.actions.sendMessage('10000001', 'привет')
    const echo: Message = { id: 'm1', chatId: '10000001', direction: 'out', text: 'привет', timestamp: 2_000, status: 'read' }
    t.store.setState(reduceEvent(t.store.getState(), { type: 'message', message: echo }))

    d.resolve({ idMessage: 'm1' })
    await p

    const s = t.store.getState()
    // Одна запись, а не дубль local-*/m1, статус — лучший из двух (read).
    expect(s.orderByChat['10000001']).toEqual(['m1'])
    expect(s.messagesById.m1!.status).toBe('read')
    t.actions.logout()
  })

  it('retryMessage не трогает уже отправленное (не local-*) сообщение, даже если сервер потом сообщил failed', async () => {
    const t = setup()
    await t.actions.login(creds, false)
    await t.actions.createChat('79991234567')
    await t.actions.sendMessage('10000001', 'привет')
    expect(t.store.getState().orderByChat['10000001']).toEqual(['m1'])
    expect(t.store.getState().messagesById.m1!.status).toBe('sent')

    // Сервер прислал статус failed уже для подтверждённого сообщения (недоставлено получателю).
    t.store.setState(reduceEvent(t.store.getState(), { type: 'status', chatId: '10000001', idMessage: 'm1', status: 'failed' }))
    expect(t.store.getState().messagesById.m1!.status).toBe('failed')

    await t.actions.retryMessage('m1')
    expect(t.api.sendMessage).toHaveBeenCalledTimes(1)
    expect(t.store.getState().messagesById.m1).toBeDefined()
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
    store.setPersistWritable(true)
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

describe('onEvent: чужой чат не переписывает persist', () => {
  it('уведомление о чате, которого нет в сторе, не даёт лишний setState от onEvent', async () => {
    const d = deferred<RawNotification | null>()
    let calls = 0
    const receiveNotification: GreenApi['receiveNotification'] = (timeoutSec, signal) => {
      calls++
      return calls === 1 ? d.promise : hangUntilAbort(timeoutSec, signal)
    }
    const t = setup(fakeApi({ receiveNotification }))
    await t.actions.login(creds, false)
    // ждём, пока опрос дойдёт до receive() и зависнет на d.promise — тогда 'connection: polling'
    // от startPolling уже применился и больше не даст постороннего setState в этом цикле.
    await vi.waitFor(() => expect(calls).toBeGreaterThan(0))

    const setStateSpy = vi.spyOn(t.store, 'setState')
    d.resolve({ receiptId: 1, body: fixtures.incomingText })
    await vi.waitFor(() => expect(t.api.deleteNotification).toHaveBeenCalledWith(1, expect.anything()))

    // единственный setState в этом цикле — от poller.onStatus('polling'), не от onEvent на чужой чат
    expect(setStateSpy).toHaveBeenCalledTimes(1)
    t.actions.logout()
  })
})

describe('одна активная вкладка: start и takeOver', () => {
  function sharedStorage(): StateStorage & { raw: string | null } {
    const st = {
      raw: null as string | null,
      getItem: () => st.raw,
      setItem: (_k: string, v: string) => void (st.raw = v),
      removeItem: () => void (st.raw = null),
    }
    return st
  }

  function tab(storage: StateStorage, locks: LocksLike | null, api = fakeApi(), loggedIn = true) {
    const store = createAppStore(storage)
    const save = vi.fn()
    const actions = createActions({
      store,
      makeApi: () => api,
      locks,
      lockWaitMs: 30,
      creds: { load: () => (loggedIn ? { creds, remember: true } : null), save, clear: () => {} },
    })
    return { store, api, actions, save }
  }

  const chat = { chatId: '10000001', phone: '79990000001', title: '+7 999 000-00-01', historyLoaded: true }

  it('первая вкладка активна и опрашивает, вторая заблокирована: не опрашивает и не пишет персист', async () => {
    const storage = sharedStorage()
    const locks = fakeLocks()
    const a = tab(storage, locks)
    const b = tab(storage, locks)

    a.actions.start()
    await vi.waitFor(() => expect(a.store.getState().tab).toBe('active'))
    expect(a.store.getState().credentials).toEqual(creds)
    await vi.waitFor(() => expect(a.api.receiveNotification).toHaveBeenCalled())
    a.store.setState({ chats: { '10000001': chat }, chatOrder: ['10000001'], ownerId: '1' })
    const written = storage.raw

    b.actions.start()
    await vi.waitFor(() => expect(b.store.getState().tab).toBe('blocked'))
    expect(b.store.getState().credentials).toBeNull()
    expect(b.api.receiveNotification).not.toHaveBeenCalled()
    b.store.setState({ chats: {}, chatOrder: [] })
    expect(storage.raw).toBe(written)
    a.actions.stop()
  })

  it('takeOver: старая вкладка останавливает опрос и больше не пишет, новая подтягивает её данные и стартует', async () => {
    const storage = sharedStorage()
    const locks = fakeLocks()
    const a = tab(storage, locks)
    const b = tab(storage, locks)
    a.actions.start()
    await vi.waitFor(() => expect(a.api.receiveNotification).toHaveBeenCalled())
    b.actions.start()
    await vi.waitFor(() => expect(b.store.getState().tab).toBe('blocked'))

    // A пишет данные уже после того, как B загрузилась со старым снимком.
    a.store.setState({ chats: { '10000001': chat }, chatOrder: ['10000001'], ownerId: '1' })

    b.actions.takeOver()
    await vi.waitFor(() => expect(b.store.getState().tab).toBe('active'))
    await vi.waitFor(() => expect(a.store.getState().tab).toBe('blocked'))

    const [, signalA] = vi.mocked(a.api.receiveNotification).mock.calls[0]!
    expect((signalA as AbortSignal).aborted).toBe(true)
    expect(a.store.getState().credentials).toEqual(creds)
    expect(b.store.getState().chats['10000001']).toBeDefined()
    await vi.waitFor(() => expect(b.api.receiveNotification).toHaveBeenCalled())

    const written = storage.raw
    a.store.setState({ chats: {}, chatOrder: [] })
    expect(storage.raw).toBe(written)
    b.actions.stop()
  })

  it('лок перехватили, пока login ждал getStateInstance: креды не сохраняются, опрос не стартует', async () => {
    const storage = sharedStorage()
    const locks = fakeLocks()
    const state = deferred<string>()
    const a = tab(storage, locks, fakeApi({ getStateInstance: vi.fn(() => state.promise) }), false)
    const b = tab(storage, locks, fakeApi(), false)
    a.actions.start()
    await vi.waitFor(() => expect(a.store.getState().tab).toBe('active'))
    b.actions.start()
    await vi.waitFor(() => expect(b.store.getState().tab).toBe('blocked'))

    const login = a.actions.login(creds, true)
    await b.actions.takeOver()
    await vi.waitFor(() => expect(a.store.getState().tab).toBe('blocked'))
    state.resolve('authorized')
    await login

    expect(a.save).not.toHaveBeenCalled()
    expect(a.store.getState().credentials).toBeNull()
    expect(a.api.receiveNotification).not.toHaveBeenCalled()
  })

  it('лок перехватили, пока новая вкладка читала storage: она не включает запись и не восстанавливает сессию', async () => {
    const shared = sharedStorage()
    const locks = fakeLocks()
    const read = deferred<void>()
    let slow = false
    // Хранилище вкладки B отвечает на чтение с задержкой, когда это включено.
    const slowStorage: StateStorage = {
      getItem: (k) => (slow ? read.promise.then(() => shared.getItem(k)) : shared.getItem(k)),
      setItem: (k, v) => shared.setItem(k, v),
      removeItem: (k) => shared.removeItem(k),
    }
    const a = tab(shared, locks)
    const b = tab(slowStorage, locks)
    a.actions.start()
    await vi.waitFor(() => expect(a.api.receiveNotification).toHaveBeenCalled())
    b.actions.start()
    await vi.waitFor(() => expect(b.store.getState().tab).toBe('blocked'))

    slow = true
    const takeOverB = b.actions.takeOver()
    await vi.waitFor(() => expect(a.store.getState().tab).toBe('blocked'))
    // Пока B ждёт storage, A забирает лок обратно.
    await a.actions.takeOver()
    await vi.waitFor(() => expect(b.store.getState().tab).toBe('blocked'))
    await vi.waitFor(() => expect(a.store.getState().tab).toBe('active'))
    const written = shared.raw
    read.resolve()
    await takeOverB
    await new Promise((r) => setTimeout(r, 0))

    expect(b.store.getState().tab).toBe('blocked')
    expect(b.api.receiveNotification).not.toHaveBeenCalled()
    b.store.setState({ chats: {} })
    expect(shared.raw).toBe(written)
    a.actions.stop()
  })

  it('Web Locks недоступны: start сразу делает вкладку активной и восстанавливает сессию', async () => {
    const t = tab(sharedStorage(), null)
    t.actions.start()
    await vi.waitFor(() => expect(t.store.getState().tab).toBe('active'))
    await vi.waitFor(() => expect(t.api.receiveNotification).toHaveBeenCalled())
    t.actions.stop()
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

describe('reloadHistory: свежая история чистит протухшие персистированные сообщения', () => {
  function makeStorage(): StateStorage {
    const m = new Map<string, string>()
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }
  }

  it('сообщение из персиста прошлой сессии (напр. старый deletedMessage-маркер) исчезает после openChat/reloadHistory', async () => {
    const storage = makeStorage()

    // Сессия 1: обычный логин + создание чата, затем вручную кладём в стор «протухшее»
    // сообщение — как будто оно осело в персисте ещё до того, как mapHistory стал
    // фильтровать служебные deletedMessage/editedMessage маркеры (было видно как пустой
    // бабл «Сообщение»).
    const store1 = createAppStore(storage)
    store1.setPersistWritable(true)
    const a1 = createActions({
      store: store1,
      makeApi: () => fakeApi(),
      locks: null,
      creds: { load: () => null, save: () => {}, clear: () => {} },
    })
    await a1.login(creds, false)
    await a1.createChat('79991234567')
    const prev = store1.getState()
    store1.setState({
      messagesById: {
        ...prev.messagesById,
        stale: { id: 'stale', chatId: '10000001', direction: 'in', text: '', timestamp: 1_000, status: 'sent' },
      },
      orderByChat: { ...prev.orderByChat, '10000001': [...(prev.orderByChat['10000001'] ?? []), 'stale'] },
    })
    a1.stop()

    // Сессия 2 (как будто перезагрузили страницу): новый стор синхронно гидрируется тем
    // же персистом, openChat дёргает reloadHistory и получает актуальную историю без 'stale'.
    const getChatHistory = vi.fn(async () => [
      {
        type: 'incoming', idMessage: 'real', timestamp: 1, typeMessage: 'textMessage',
        chatId: '10000001', textMessage: 'привет',
      },
    ] as RawHistoryItem[])
    const store2 = createAppStore(storage)
    expect(store2.getState().messagesById.stale).toBeDefined()
    const a2 = createActions({
      store: store2,
      makeApi: () => fakeApi({ getChatHistory }),
      locks: null,
      creds: { load: () => null, save: () => {}, clear: () => {} },
    })
    await a2.login(creds, false)
    await a2.openChat('10000001')

    const s = store2.getState()
    expect(s.messagesById.stale).toBeUndefined()
    expect(s.orderByChat['10000001']).toEqual(['real'])
    a2.stop()
  })
})

describe('reloadHistory: буфер pendingStatus применяется к сообщению, пришедшему из истории', () => {
  it('статус, буферизованный раньше, чем сообщение вообще появилось в сторе, применяется после reloadHistory', async () => {
    // Первый вызов (внутри createChat/openChat) — пустая история, сообщения ещё нет нигде.
    // Второй (наш явный reloadHistory ниже) — история уже содержит это сообщение.
    const getChatHistory = vi
      .fn(async () => [] as RawHistoryItem[])
      .mockImplementationOnce(async () => [])
      .mockImplementation(async () => [
        {
          type: 'outgoing', idMessage: 'out-9', timestamp: 1, typeMessage: 'textMessage',
          chatId: '10000001', textMessage: 'привет',
        },
      ] as RawHistoryItem[])
    const t = setup(fakeApi({ getChatHistory }))
    await t.actions.login(creds, false)
    await t.actions.createChat('79991234567')

    // Статус приходит по опросу для сообщения, которого ещё нет в сторе (буферизуется).
    t.store.setState(reduceEvent(t.store.getState(), { type: 'status', chatId: '10000001', idMessage: 'out-9', status: 'read' }))
    expect(t.store.getState().pendingStatus['out-9']).toBe('read')

    await t.actions.reloadHistory('10000001')

    const s = t.store.getState()
    // Из истории сообщение пришло бы со статусом 'sent' (нет statusMessage) — но буфер
    // 'read' применяется поверх, а не теряется, и сама запись в буфере вычищается.
    expect(s.messagesById['out-9']!.status).toBe('read')
    expect(s.pendingStatus['out-9']).toBeUndefined()
    t.actions.logout()
  })
})

describe('reloadHistory: rawMaxTs учитывает маркеры deletedMessage/editedMessage вне items', () => {
  it('протухший бабл новее последнего настоящего сообщения, но старше маркера из сырого ответа — убирается', async () => {
    const getChatHistory = vi.fn(async () => [
      { type: 'outgoing', idMessage: 'real', timestamp: 1, typeMessage: 'textMessage', chatId: '10000001', textMessage: 'привет' },
      { type: 'outgoing', idMessage: 'del-1', timestamp: 3, typeMessage: 'deletedMessage', chatId: '10000001' },
    ] as RawHistoryItem[])
    const t = setup(fakeApi({ getChatHistory }))
    await t.actions.login(creds, false)
    await t.actions.createChat('79991234567')

    // Протухший бабл от старого маркера (как будто осел в персисте ещё до того, как mapHistory
    // стал их фильтровать) — 2000мс, между 'real' (1000мс) и маркером (3000мс). Вне окна по
    // items (toTs был бы 1000), но внутри по rawMaxTs.
    t.store.setState((s) => ({
      messagesById: {
        ...s.messagesById,
        stale: { id: 'stale', chatId: '10000001', direction: 'in', text: '', timestamp: 2000, status: 'sent' },
      },
      orderByChat: { ...s.orderByChat, '10000001': [...(s.orderByChat['10000001'] ?? []), 'stale'] },
    }))

    await t.actions.reloadHistory('10000001')

    expect(t.store.getState().messagesById.stale).toBeUndefined()
    t.actions.logout()
  })
})

describe('reloadHistory: гонка с поллером во время ожидания getChatHistory', () => {
  it('входящее, пришедшее пока getChatHistory висит в ожидании, не удаляется реконсиляцией', async () => {
    const d = deferred<RawHistoryItem[]>()
    const getChatHistory = vi
      .fn(async () => [] as RawHistoryItem[])
      .mockImplementationOnce(async () => [])
      .mockImplementationOnce(() => d.promise)
    const t = setup(fakeApi({ getChatHistory }))
    await t.actions.login(creds, false)
    await t.actions.createChat('79991234567')

    const p = t.actions.reloadHistory('10000001')
    // Пока getChatHistory висит, «приходит» входящее — так, как это сделал бы
    // поллер через onEvent → reduceEvent → set (без обращения к внутреннему set()).
    const incoming: Message = {
      id: 'in-1', chatId: '10000001', direction: 'in', text: 'привет', timestamp: 2_000, status: 'sent',
    }
    t.store.setState(reduceEvent(t.store.getState(), { type: 'message', message: incoming }))

    // История резолвится без incoming (сервер посчитал её раньше, чем оно пришло).
    d.resolve([
      { type: 'incoming', idMessage: 'real', timestamp: 1, typeMessage: 'textMessage', chatId: '10000001', textMessage: 'ок' },
    ])
    await p

    const s = t.store.getState()
    expect(s.messagesById['in-1']).toBeDefined()
    expect(s.orderByChat['10000001']).toEqual(['real', 'in-1'])
    t.actions.logout()
  })
})
