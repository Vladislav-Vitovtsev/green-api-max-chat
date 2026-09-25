import type { StateStorage } from 'zustand/middleware'
import type { GreenApi } from '../../api/client/greenApi'
import { ApiError } from '../../api/errors/errors'
import type { RawChatSummary, RawHistoryItem, RawNotification } from '../../api/client/types'
import { fixtures } from '../../core/notifications/__fixtures__/notifications'
import type { LocksLike } from '../../core/tabLock/tabLock'
import { fakeLocks } from '../../test/fakeLocks'
import type { Message } from '../../core/model'
import {
  createActions, HISTORY_COUNT, HISTORY_GAP_MS, HISTORY_MAX_RETRIES, PREVIEW_COUNT, PREVIEW_MAX_RETRIES, PREVIEW_PAUSE_MS,
} from './actions'
import { reduceEvent, unreadOf } from '../reduce/reduce'
import { createAppStore, type AppStore } from '../store'

const creds = { apiUrl: 'https://api.green-api.com', idInstance: '1', apiTokenInstance: 't' }
const badge = (store: AppStore, chatId: string) => unreadOf(store.getState(), chatId)
const instantSleep = () => Promise.resolve()

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

function afterBackgroundSync<T>(impl: () => Promise<T>) {
  return vi.fn<() => Promise<T>>().mockImplementationOnce(() => new Promise<T>(() => {})).mockImplementation(impl)
}

function fakeApi(over: Partial<GreenApi> = {}): GreenApi {
  return {
    getStateInstance: vi.fn(async () => 'authorized'),
    sendMessage: vi.fn(async () => ({ idMessage: 'm1' })),
    getChatHistory: vi.fn(async () => []),
    checkAccount: vi.fn(async () => ({ exist: true, chatId: '10000001' })),
    receiveNotification: vi.fn(hangUntilAbort),
    deleteNotification: vi.fn(async () => {}),
    getChats: vi.fn(async () => []),
    lastIncomingMessages: vi.fn(async () => []),
    lastOutgoingMessages: vi.fn(async () => []),
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
    sleep: instantSleep,
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

  it('номер автосозданного чата с пустым phone заполняет его, а не плодит дубликат', async () => {
    const t = setup()
    await t.actions.login(creds, false)
    t.store.setState(reduceEvent(t.store.getState(), {
      type: 'message',
      chatName: 'Аноним',
      chatType: 'user',
      message: { id: 'in-1', chatId: '10000001', direction: 'in', text: 'привет', timestamp: 1_000, status: 'sent' },
    }))
    expect(t.store.getState().chats['10000001']).toMatchObject({ phone: '', title: 'Аноним' })

    await expect(t.actions.createChat('79991234567')).resolves.toEqual({ ok: true, chatId: '10000001' })
    const s = t.store.getState()
    expect(Object.keys(s.chats)).toEqual(['10000001'])
    expect(s.chats['10000001']).toMatchObject({ phone: '79991234567', title: 'Аноним' })
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

describe('onEvent: уведомление из группы или канала не переписывает persist', () => {
  it('сообщение из группы/канала не создаёт чат и не даёт лишний setState от onEvent', async () => {
    const d = deferred<RawNotification | null>()
    let calls = 0
    const receiveNotification: GreenApi['receiveNotification'] = (timeoutSec, signal) => {
      calls++
      return calls === 1 ? d.promise : hangUntilAbort(timeoutSec, signal)
    }
    const t = setup(fakeApi({ receiveNotification }))
    await t.actions.login(creds, false)
    await vi.waitFor(() => expect(calls).toBeGreaterThan(0))

    const setStateSpy = vi.spyOn(t.store, 'setState')
    d.resolve({ receiptId: 1, body: fixtures.incomingGroupText })
    await vi.waitFor(() => expect(t.api.deleteNotification).toHaveBeenCalledWith(1, expect.anything()))

    expect(setStateSpy).toHaveBeenCalledTimes(1)
    expect(t.store.getState().chats).toEqual({})
    t.actions.logout()
  })

  it('сообщение от неизвестного собеседника, наоборот, создаёт чат через onEvent', async () => {
    const d = deferred<RawNotification | null>()
    let calls = 0
    const receiveNotification: GreenApi['receiveNotification'] = (timeoutSec, signal) => {
      calls++
      return calls === 1 ? d.promise : hangUntilAbort(timeoutSec, signal)
    }
    const t = setup(fakeApi({ receiveNotification }))
    await t.actions.login(creds, false)
    await vi.waitFor(() => expect(calls).toBeGreaterThan(0))

    d.resolve({ receiptId: 1, body: fixtures.incomingText })
    await vi.waitFor(() => expect(t.api.deleteNotification).toHaveBeenCalledWith(1, expect.anything()))

    expect(t.store.getState().chats['10000001']).toMatchObject({ phone: '79990000002', title: 'Тест Тестов' })
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

    t.store.setState(reduceEvent(t.store.getState(), { type: 'status', chatId: '10000001', idMessage: 'out-9', status: 'read' }))
    expect(t.store.getState().pendingStatus['out-9']).toBe('read')

    await t.actions.reloadHistory('10000001')

    const s = t.store.getState()
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
    const incoming: Message = {
      id: 'in-1', chatId: '10000001', direction: 'in', text: 'привет', timestamp: 2_000, status: 'sent',
    }
    t.store.setState(reduceEvent(t.store.getState(), { type: 'message', message: incoming }))

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

describe('syncChatList', () => {
  it('успешный login запускает синхронизацию списка чатов', async () => {
    const t = setup()
    await t.actions.login(creds, false)
    await vi.waitFor(() => expect(t.api.getChats).toHaveBeenCalled())
    t.actions.logout()
  })

  it('restore тоже запускает синхронизацию списка чатов', async () => {
    const api = fakeApi()
    const store = createAppStore({ getItem: () => null, setItem: () => {}, removeItem: () => {} })
    const actions = createActions({
      store, makeApi: () => api, locks: null,
      creds: { load: () => ({ creds, remember: true }), save: () => {}, clear: () => {} },
    })
    actions.restore()
    await vi.waitFor(() => expect(api.getChats).toHaveBeenCalled())
    actions.logout()
  })

  it('мёрджит getChats без удаления существующих чатов, создаёт только type user', async () => {
    const getChats = afterBackgroundSync(async (): Promise<RawChatSummary[]> => [
      { chatId: '10000001', name: 'Иван', phoneNumber: 79991234567, type: 'user', unreadCount: 2 },
      { chatId: '20000001', name: 'Группа', type: 'group', unreadCount: 0 },
    ])
    const t = setup(fakeApi({ getChats }))
    await t.actions.login(creds, false)
    t.store.setState((s) => ({
      chats: { ...s.chats, '99': { chatId: '99', phone: '', title: 'Старый', historyLoaded: false } },
      chatOrder: [...s.chatOrder, '99'],
    }))

    await t.actions.syncChatList()

    const s = t.store.getState()
    expect(s.chats['10000001']).toMatchObject({
      chatId: '10000001', phone: '79991234567', title: 'Иван', historyLoaded: false, serverUnread: 2,
    })
    expect(s.chats['20000001']).toBeUndefined()
    expect(s.chats['99']).toBeDefined()
    t.actions.logout()
  })

  it('для существующего чата заполняет пустой телефон и повышает плейсхолдер-заголовок, не трогает уже заданный', async () => {
    const getChats = afterBackgroundSync(async (): Promise<RawChatSummary[]> => [
      { chatId: '10000001', name: 'Тест Тестов', phoneNumber: 79990000002, type: 'user', unreadCount: 0 },
      { chatId: '10000002', name: 'Другое имя', phoneNumber: 79990000003, type: 'user', unreadCount: 0 },
    ])
    const t = setup(fakeApi({ getChats }))
    await t.actions.login(creds, false)
    t.store.setState((s) => ({
      chats: {
        ...s.chats,
        '10000001': { chatId: '10000001', phone: '', title: '10000001', historyLoaded: false },
        '10000002': { chatId: '10000002', phone: '79990000003', title: 'Уже названо', historyLoaded: false },
      },
      chatOrder: [...s.chatOrder, '10000001', '10000002'],
    }))

    await t.actions.syncChatList()

    const s = t.store.getState()
    expect(s.chats['10000001']).toMatchObject({ phone: '79990000002', title: 'Тест Тестов' })
    expect(s.chats['10000002']).toMatchObject({ phone: '79990000003', title: 'Уже названо' })
    t.actions.logout()
  })

  it('чат ни разу не открывали: бейдж берётся из unreadCount, у активного чата бейджа нет', async () => {
    const getChats = afterBackgroundSync(async (): Promise<RawChatSummary[]> => [
      { chatId: '10000001', name: 'Иван', phoneNumber: 79990000002, type: 'user', unreadCount: 5 },
      { chatId: '10000002', name: 'Пётр', phoneNumber: 79990000003, type: 'user', unreadCount: 2 },
    ])
    const t = setup(fakeApi({ getChats }))
    await t.actions.login(creds, false)
    t.store.setState({ activeChatId: '10000001' })

    await t.actions.syncChatList()

    expect(badge(t.store, '10000001')).toBe(0)
    expect(badge(t.store, '10000002')).toBe(2)
    t.actions.logout()
  })

  it('порядок: чаты с lastMessageAt по убыванию впереди, остальные — в порядке getChats', async () => {
    const getChats = afterBackgroundSync(async (): Promise<RawChatSummary[]> => [
      { chatId: 'b', name: 'Б', type: 'user', unreadCount: 0 },
      { chatId: 'a', name: 'А', type: 'user', unreadCount: 0 },
    ])
    const t = setup(fakeApi({ getChats }))
    await t.actions.login(creds, false)
    t.store.setState((s) => ({
      chats: { ...s.chats, old: { chatId: 'old', phone: '', title: 'Старый', historyLoaded: false, lastMessageAt: 500 } },
      chatOrder: [...s.chatOrder, 'old'],
      messagesById: { ...s.messagesById, o1: { id: 'o1', chatId: 'old', direction: 'in', text: 'о', timestamp: 500, status: 'sent' } },
      orderByChat: { ...s.orderByChat, old: ['o1'] },
    }))

    await t.actions.syncChatList()

    expect(t.store.getState().chatOrder).toEqual(['old', 'b', 'a'])
    t.actions.logout()
  })

  it('журналы за 7 дней (minutes=10080) заполняют превью и lastMessageAt только для чатов, оставшихся после мёржа', async () => {
    const getChats = afterBackgroundSync(async (): Promise<RawChatSummary[]> => [
      { chatId: '10000001', name: 'Иван', phoneNumber: 79990000002, type: 'user', unreadCount: 0 },
    ])
    const items: RawHistoryItem[] = [
      { type: 'incoming', idMessage: 'j1', timestamp: 100, typeMessage: 'textMessage', chatId: '10000001', textMessage: 'привет' },
      { type: 'incoming', idMessage: 'j2', timestamp: 200, typeMessage: 'textMessage', chatId: '20000001', textMessage: 'чужой чат' },
    ]
    const lastIncomingMessages = vi.fn(async () => items)
    const lastOutgoingMessages = vi.fn(async (): Promise<RawHistoryItem[]> => [])
    const t = setup(fakeApi({ getChats, lastIncomingMessages, lastOutgoingMessages }))
    await t.actions.login(creds, false)

    await t.actions.syncChatList()

    expect(lastIncomingMessages).toHaveBeenCalledWith(10080, expect.anything())
    expect(lastOutgoingMessages).toHaveBeenCalledWith(10080, expect.anything())
    const s = t.store.getState()
    expect(s.messagesById['j1']).toBeDefined()
    expect(s.messagesById['j2']).toBeUndefined()
    expect(s.chats['20000001']).toBeUndefined()
    expect(s.chats['10000001']!.lastMessageAt).toBe(100_000)
    t.actions.logout()
  })

  it('ошибка getChats не падает, тихо логируется по kind', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const getChats = afterBackgroundSync(async (): Promise<RawChatSummary[]> => {
      throw new ApiError('network')
    })
    const t = setup(fakeApi({ getChats }))
    await t.actions.login(creds, false)

    await t.actions.syncChatList()

    expect(err).toHaveBeenCalledWith('[syncChatList]', 'network')
    expect(t.store.getState().chats).toEqual({})
    t.actions.logout()
    err.mockRestore()
  })

  it('поколение: getChats, разрешившийся после logout, не создаёт чат', async () => {
    const d = deferred<RawChatSummary[]>()
    const getChats = vi.fn(() => d.promise)
    const t = setup(fakeApi({ getChats }))
    await t.actions.login(creds, false)
    const p = t.actions.syncChatList()
    t.actions.logout()
    d.resolve([{ chatId: '10000001', name: 'Иван', phoneNumber: 79990000002, type: 'user', unreadCount: 1 }])
    await p
    expect(t.store.getState().chats).toEqual({})
  })

  it('поколение: logout между мёрджем и журналами — отложенные журналы не пишутся', async () => {
    const d = deferred<RawHistoryItem[]>()
    const getChats = vi.fn(async (): Promise<RawChatSummary[]> => [
      { chatId: '10000001', name: 'Иван', phoneNumber: 79990000002, type: 'user', unreadCount: 0 },
    ])
    const lastIncomingMessages = vi.fn(() => d.promise)
    const lastOutgoingMessages = vi.fn(async (): Promise<RawHistoryItem[]> => [])
    const t = setup(fakeApi({ getChats, lastIncomingMessages, lastOutgoingMessages }))
    await t.actions.login(creds, false)
    const p = t.actions.syncChatList()
    await vi.waitFor(() => expect(t.store.getState().chats['10000001']).toBeDefined())
    t.actions.logout()
    d.resolve([
      { type: 'incoming', idMessage: 'j1', timestamp: 1, typeMessage: 'textMessage', chatId: '10000001', textMessage: 'привет' },
    ])
    await p
    expect(t.store.getState().messagesById['j1']).toBeUndefined()
  })
})

describe('openChat: отметка прочтения', () => {
  it('открытие и уход из чата: входящие до ухода прочитаны, новое после ухода даёт бейдж 1', async () => {
    const t = setup()
    await t.actions.login(creds, false)
    const incoming = (id: string, timestamp: number) => t.store.setState(reduceEvent(t.store.getState(), {
      type: 'message', chatType: 'user', peerPhone: '79990000002',
      message: { id, chatId: '10000001', direction: 'in', text: id, timestamp, status: 'sent' },
    }))
    incoming('a', 1_000)
    incoming('b', 2_000)
    expect(badge(t.store, '10000001')).toBe(2)

    await t.actions.openChat('10000001')
    incoming('c', 3_000)
    await t.actions.openChat(null)
    expect(t.store.getState().chats['10000001']!.readUpTo).toBe(3_000)
    expect(badge(t.store, '10000001')).toBe(0)

    incoming('d', 4_000)
    expect(badge(t.store, '10000001')).toBe(1)
    t.actions.logout()
  })

  it('своё отправленное сообщение бейдж не создаёт', async () => {
    const t = setup()
    await t.actions.login(creds, false)
    await t.actions.createChat('79991234567')
    await t.actions.sendMessage('10000001', 'привет')
    await t.actions.openChat(null)
    expect(badge(t.store, '10000001')).toBe(0)
    t.actions.logout()
  })
})

describe('digitsOf: phoneNumber 0/пусто/не задан → пустая строка', () => {
  it('phoneNumber 0 не превращается в телефон "0"', async () => {
    const getChats = vi.fn(async (): Promise<RawChatSummary[]> => [
      { chatId: '10000001', name: 'Без номера', phoneNumber: 0, type: 'user', unreadCount: 0 },
    ])
    const t = setup(fakeApi({ getChats }))
    await t.actions.login(creds, false)
    await t.actions.syncChatList()
    expect(t.store.getState().chats['10000001']!.phone).toBe('')
    t.actions.logout()
  })
})

describe('порядок: lastMessageAt только из сообщений', () => {
  it('createChat не задирает lastMessageAt текущим временем — новый чат без сообщений не обгоняет чаты с реальной перепиской', async () => {
    const t = setup()
    await t.actions.login(creds, false)
    t.store.setState((s) => ({
      chats: { ...s.chats, old: { chatId: 'old', phone: '', title: 'Старый', historyLoaded: true, lastMessageAt: 5_000 } },
      chatOrder: [...s.chatOrder, 'old'],
    }))

    await t.actions.createChat('79991234567')

    const s = t.store.getState()
    expect(s.chats['10000001']!.lastMessageAt).toBeUndefined()
    expect(s.chatOrder).toEqual(['old', '10000001'])
    t.actions.logout()
  })

  it('sync самолечит lastMessageAt по хвосту реальных сообщений, у чата без сообщений снимает его', async () => {
    const t = setup()
    await t.actions.login(creds, false)
    t.store.setState((s) => ({
      chats: {
        ...s.chats,
        buggy: { chatId: 'buggy', phone: '', title: 'Баг', historyLoaded: true, lastMessageAt: 9_999_999 },
        real: { chatId: 'real', phone: '', title: 'Реальный', historyLoaded: true, lastMessageAt: 5_000 },
      },
      chatOrder: [...s.chatOrder, 'buggy', 'real'],
      messagesById: {
        ...s.messagesById,
        m1: { id: 'm1', chatId: 'buggy', direction: 'in', text: 'привет', timestamp: 1_000, status: 'sent' },
      },
      orderByChat: { ...s.orderByChat, buggy: ['m1'] },
    }))

    await t.actions.syncChatList()

    const s = t.store.getState()
    expect(s.chats['buggy']!.lastMessageAt).toBe(1_000)
    expect(s.chats['real']!.lastMessageAt).toBeUndefined()
    expect(s.chatOrder.indexOf('buggy')).toBeLessThan(s.chatOrder.indexOf('real'))
    t.actions.logout()
  })
})

describe('бейдж после F5: readUpTo переживает перезагрузку', () => {
  function makeStorage(): StateStorage {
    const m = new Map<string, string>()
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }
  }

  function session(storage: StateStorage, over: Partial<GreenApi> = {}) {
    const store = createAppStore(storage)
    store.setPersistWritable(true)
    const actions = createActions({
      store, makeApi: () => fakeApi(over), locks: null, now: () => 1_000,
      creds: { load: () => null, save: () => {}, clear: () => {} },
    })
    return { store, actions }
  }

  const staleServer = (unreadCount: number) =>
    vi.fn(async (): Promise<RawChatSummary[]> => [
      { chatId: '10000001', name: 'Тест Тестов', phoneNumber: 79990000002, type: 'user', unreadCount },
    ])

  async function readChatThenReload(storage: StateStorage) {
    const first = session(storage)
    await first.actions.login(creds, false)
    first.store.setState(reduceEvent(first.store.getState(), {
      type: 'message', chatType: 'user', peerPhone: '79990000002',
      message: { id: 'm1', chatId: '10000001', direction: 'in', text: 'привет', timestamp: 5_000, status: 'sent' },
    }))
    await first.actions.openChat('10000001')
    await first.actions.openChat(null)
    first.actions.stop()
  }

  it('прочитали, F5, сервер всё ещё говорит unreadCount 3, новых входящих нет - бейдж 0', async () => {
    const storage = makeStorage()
    await readChatThenReload(storage)
    const second = session(storage, { getChats: staleServer(3) })
    await second.store.persist.rehydrate()
    await second.actions.login(creds, false)
    await second.actions.syncChatList()
    expect(badge(second.store, '10000001')).toBe(0)
    second.actions.stop()
  })

  it('пока вкладка была закрыта, пришло входящее: журнал приносит его после F5 - бейдж 1', async () => {
    const storage = makeStorage()
    await readChatThenReload(storage)
    const second = session(storage, {
      getChats: staleServer(1),
      lastIncomingMessages: vi.fn(async (): Promise<RawHistoryItem[]> => [
        { type: 'incoming', idMessage: 'm1', timestamp: 5, typeMessage: 'textMessage', chatId: '10000001', textMessage: 'привет' },
        { type: 'incoming', idMessage: 'm2', timestamp: 9, typeMessage: 'textMessage', chatId: '10000001', textMessage: 'ты тут?' },
      ]),
    })
    await second.store.persist.rehydrate()
    await second.actions.login(creds, false)
    await second.actions.syncChatList()
    expect(badge(second.store, '10000001')).toBe(1)
    second.actions.stop()
  })

  it('история, пришедшая после открытия, тоже считается прочитанной - после F5 бейджа нет', async () => {
    const storage = makeStorage()
    const first = session(storage, {
      getChatHistory: vi.fn(async (): Promise<RawHistoryItem[]> => [
        { type: 'incoming', idMessage: 'h1', timestamp: 7, typeMessage: 'textMessage', chatId: '10000001', textMessage: 'старое' },
        { type: 'incoming', idMessage: 'h2', timestamp: 8, typeMessage: 'textMessage', chatId: '10000001', textMessage: 'новое' },
      ]),
    })
    await first.actions.login(creds, false)
    await first.actions.createChat('79991234567')
    expect(first.store.getState().chats['10000001']!.readUpTo).toBe(8_000)
    await first.actions.openChat(null)
    first.actions.stop()

    const second = session(storage, { getChats: staleServer(2) })
    await second.store.persist.rehydrate()
    await second.actions.login(creds, false)
    await second.actions.syncChatList()
    expect(badge(second.store, '10000001')).toBe(0)
    second.actions.stop()
  })

  it('старое поле unread из персиста выбрасывается при гидратации', async () => {
    const storage = makeStorage()
    storage.setItem('max-chat:data', JSON.stringify({
      version: 2,
      state: {
        chats: { '10000001': { chatId: '10000001', phone: '', title: 'Иван', historyLoaded: false, unread: 7 } },
        chatOrder: ['10000001'], messagesById: {}, orderByChat: {}, ownerId: '1',
      },
    }))
    const { store } = session(storage)
    await store.persist.rehydrate()
    expect(store.getState().chats['10000001']).not.toHaveProperty('unread')
    expect(badge(store, '10000001')).toBe(0)
  })
})

describe('syncChatList: журналы склеивают эхо с local-*/failed по тексту (C7), без дубля', () => {
  it('провалившееся по таймауту local- + то же сообщение в lastOutgoingMessages — одно сообщение, не failed', async () => {
    const getChats = afterBackgroundSync(async (): Promise<RawChatSummary[]> => [
      { chatId: '10000001', name: 'Иван', phoneNumber: 79990000002, type: 'user', unreadCount: 0 },
    ])
    const lastOutgoingMessages = vi.fn(async (): Promise<RawHistoryItem[]> => [
      { type: 'outgoing', idMessage: 'real-9', timestamp: 1, typeMessage: 'textMessage', chatId: '10000001', textMessage: 'привет' },
    ])
    const t = setup(fakeApi({ getChats, lastOutgoingMessages }))
    await t.actions.login(creds, false)
    t.store.setState((s) => ({
      chats: { ...s.chats, '10000001': { chatId: '10000001', phone: '79990000002', title: 'Иван', historyLoaded: true } },
      chatOrder: [...s.chatOrder, '10000001'],
      messagesById: {
        ...s.messagesById,
        'local-x': { id: 'local-x', chatId: '10000001', direction: 'out', text: 'привет', timestamp: 500, status: 'failed' },
      },
      orderByChat: { ...s.orderByChat, '10000001': ['local-x'] },
    }))

    await t.actions.syncChatList()

    const s = t.store.getState()
    expect(s.orderByChat['10000001']).toEqual(['real-9'])
    expect(s.messagesById['local-x']).toBeUndefined()
    expect(s.messagesById['real-9']!.status).not.toBe('failed')
    t.actions.logout()
  })
})

describe('syncChatList: нормализация chatId в журналах ("@…" суффикс)', () => {
  it('lastIncomingMessages с chatId вида "10000001@c.us" мёржится в чат без суффикса', async () => {
    const getChats = vi.fn(async (): Promise<RawChatSummary[]> => [
      { chatId: '10000001', name: 'Иван', phoneNumber: 79990000002, type: 'user', unreadCount: 0 },
    ])
    const lastIncomingMessages = vi.fn(async (): Promise<RawHistoryItem[]> => [
      { type: 'incoming', idMessage: 'j1', timestamp: 100, typeMessage: 'textMessage', chatId: '10000001@c.us', textMessage: 'привет' },
    ])
    const t = setup(fakeApi({ getChats, lastIncomingMessages }))
    await t.actions.login(creds, false)

    await t.actions.syncChatList()

    const s = t.store.getState()
    expect(s.messagesById['j1']).toBeDefined()
    expect(s.orderByChat['10000001']).toEqual(['j1'])
    t.actions.logout()
  })
})

describe('syncChatList: гонка непрочитанных с живым поллером (два окна)', () => {
  it('окно А: входящее создаёт чат, пока висит getChats со старым 0 - бейдж 1 остаётся', async () => {
    const d = deferred<RawChatSummary[]>()
    const getChats = vi.fn(() => d.promise)
    const lastIncomingMessages = vi.fn(async (): Promise<RawHistoryItem[]> => [
      { type: 'incoming', idMessage: 'live-1', timestamp: 2, typeMessage: 'textMessage', chatId: '10000001', textMessage: 'привет' },
    ])
    const lastOutgoingMessages = vi.fn(async (): Promise<RawHistoryItem[]> => [])
    const t = setup(fakeApi({ getChats, lastIncomingMessages, lastOutgoingMessages }))
    await t.actions.login(creds, false)
    const p = t.actions.syncChatList()

    t.store.setState(reduceEvent(t.store.getState(), {
      type: 'message', chatType: 'user', peerPhone: '79990000002',
      message: { id: 'live-1', chatId: '10000001', direction: 'in', text: 'привет', timestamp: 2_000, status: 'sent' },
    }))
    expect(badge(t.store, '10000001')).toBe(1)

    d.resolve([{ chatId: '10000001', name: 'Иван', phoneNumber: 79990000002, type: 'user', unreadCount: 0 }])
    await p

    expect(badge(t.store, '10000001')).toBe(1)
    t.actions.logout()
  })

  it('окно Б: входящее приходит, пока висят журналы - учитывается один раз, без задвоения', async () => {
    const d = deferred<RawHistoryItem[]>()
    const getChats = vi.fn(async (): Promise<RawChatSummary[]> => [
      { chatId: '10000001', name: 'Иван', phoneNumber: 79990000002, type: 'user', unreadCount: 2 },
    ])
    const lastIncomingMessages = vi.fn(() => d.promise)
    const lastOutgoingMessages = vi.fn(async (): Promise<RawHistoryItem[]> => [])
    const t = setup(fakeApi({ getChats, lastIncomingMessages, lastOutgoingMessages }))
    await t.actions.login(creds, false)
    const p = t.actions.syncChatList()
    await vi.waitFor(() => expect(t.store.getState().chats['10000001']).toBeDefined())
    expect(badge(t.store, '10000001')).toBe(2)

    t.store.setState(reduceEvent(t.store.getState(), {
      type: 'message',
      message: { id: 'live-2', chatId: '10000001', direction: 'in', text: 'ещё', timestamp: 5_000, status: 'sent' },
    }))
    expect(badge(t.store, '10000001')).toBe(3)

    d.resolve([
      { type: 'incoming', idMessage: 'live-2', timestamp: 5, typeMessage: 'textMessage', chatId: '10000001', textMessage: 'ещё' },
    ])
    await p

    expect(badge(t.store, '10000001')).toBe(3)
    t.actions.logout()
  })
})

describe('syncChatList: no-op не создаёт новых ссылок и не пишет стор повторно', () => {
  it('повторный sync без новых данных не вызывает setState и сохраняет ссылки chats/chatOrder/messagesById', async () => {
    const getChats = afterBackgroundSync(async (): Promise<RawChatSummary[]> => [
      { chatId: '10000001', name: 'Иван', phoneNumber: 79990000002, type: 'user', unreadCount: 0 },
    ])
    const lastIncomingMessages = vi.fn(async (): Promise<RawHistoryItem[]> => [
      { type: 'incoming', idMessage: 'j1', timestamp: 100, typeMessage: 'textMessage', chatId: '10000001', textMessage: 'привет' },
    ])
    const t = setup(fakeApi({ getChats, lastIncomingMessages, lastOutgoingMessages: vi.fn(async () => []) }))
    await t.actions.login(creds, false)
    await t.actions.syncChatList()
    const s1 = t.store.getState()

    const setStateSpy = vi.spyOn(t.store, 'setState')
    await t.actions.syncChatList()

    expect(setStateSpy).not.toHaveBeenCalled()
    const s2 = t.store.getState()
    expect(s2.chats).toBe(s1.chats)
    expect(s2.chatOrder).toBe(s1.chatOrder)
    expect(s2.messagesById).toBe(s1.messagesById)
    expect(s2.orderByChat).toBe(s1.orderByChat)
    t.actions.logout()
  })
})

describe('syncChatList: фоновая подгрузка превью для старых чатов без сообщений', () => {
  function setupPreview(api: GreenApi) {
    const store: AppStore = createAppStore({ getItem: () => null, setItem: () => {}, removeItem: () => {} })
    const sleeps: number[] = []
    const actions = createActions({
      store, makeApi: () => api, locks: null,
      creds: { load: () => null, save: () => {}, clear: () => {} },
      sleep: (ms) => {
        sleeps.push(ms)
        return Promise.resolve()
      },
    })
    return { store, actions, sleeps }
  }

  it('после sync подтягивает getChatHistory(chatId, PREVIEW_COUNT) по одному для чатов без сообщений, с паузой между запросами', async () => {
    const getChats = afterBackgroundSync(async (): Promise<RawChatSummary[]> => [
      { chatId: 'a', name: 'А', type: 'user', unreadCount: 0 },
      { chatId: 'b', name: 'Б', type: 'user', unreadCount: 0 },
    ])
    const calls: string[] = []
    const getChatHistory = vi.fn(async (chatId: string, count: number): Promise<RawHistoryItem[]> => {
      expect(count).toBe(PREVIEW_COUNT)
      calls.push(chatId)
      return [{ type: 'incoming', idMessage: `${chatId}-1`, timestamp: 1, typeMessage: 'textMessage', chatId, textMessage: 'превью' }]
    })
    const api = fakeApi({ getChats, getChatHistory })
    const { store, actions, sleeps } = setupPreview(api)
    await actions.login(creds, false)
    await actions.syncChatList()

    await vi.waitFor(() => expect(calls).toEqual(['a', 'b']))
    expect(sleeps).toContain(PREVIEW_PAUSE_MS)
    await vi.waitFor(() => expect(store.getState().messagesById['a-1']).toBeDefined())
    expect(store.getState().messagesById['b-1']).toBeDefined()
    expect(store.getState().chats['a']!.lastMessageAt).toBe(1_000)
    actions.stop()
  })

  it('чат, у которого уже есть сообщения из журнала, не подтягивается повторно', async () => {
    const getChats = afterBackgroundSync(async (): Promise<RawChatSummary[]> => [{ chatId: 'a', name: 'А', type: 'user', unreadCount: 0 }])
    const lastIncomingMessages = vi.fn(async (): Promise<RawHistoryItem[]> => [
      { type: 'incoming', idMessage: 'j1', timestamp: 1, typeMessage: 'textMessage', chatId: 'a', textMessage: 'привет' },
    ])
    const getChatHistory = vi.fn(async (): Promise<RawHistoryItem[]> => [])
    const api = fakeApi({ getChats, lastIncomingMessages, getChatHistory })
    const { actions } = setupPreview(api)
    await actions.login(creds, false)
    await actions.syncChatList()

    expect(getChatHistory).not.toHaveBeenCalled()
    actions.stop()
  })

  it('429 (rateLimit) ставит паузу с бэкоффом и повторяет тот же чат вместо перехода к следующему', async () => {
    const getChats = afterBackgroundSync(async (): Promise<RawChatSummary[]> => [{ chatId: 'a', name: 'А', type: 'user', unreadCount: 0 }])
    const getChatHistory = vi
      .fn<GreenApi['getChatHistory']>()
      .mockRejectedValueOnce(new ApiError('rateLimit'))
      .mockResolvedValueOnce([
        { type: 'incoming', idMessage: 'a-1', timestamp: 1, typeMessage: 'textMessage', chatId: 'a', textMessage: 'превью' },
      ])
    const api = fakeApi({ getChats, getChatHistory })
    const { store, actions } = setupPreview(api)
    await actions.login(creds, false)
    await actions.syncChatList()

    await vi.waitFor(() => expect(store.getState().messagesById['a-1']).toBeDefined())
    expect(getChatHistory).toHaveBeenCalledTimes(2)
    actions.stop()
  })

  it('берёт последнее настоящее сообщение, служебные маркеры в конце ответа пропускает', async () => {
    const getChats = afterBackgroundSync(async (): Promise<RawChatSummary[]> => [{ chatId: 'a', name: 'А', type: 'user', unreadCount: 0 }])
    const getChatHistory = vi.fn(async (): Promise<RawHistoryItem[]> => [
      { type: 'incoming', idMessage: 'a-2', timestamp: 3, typeMessage: 'deletedMessage', chatId: 'a' },
      { type: 'incoming', idMessage: 'a-1', timestamp: 2, typeMessage: 'textMessage', chatId: 'a', textMessage: 'превью' },
    ])
    const { store, actions } = setupPreview(fakeApi({ getChats, getChatHistory }))
    await actions.login(creds, false)
    await actions.syncChatList()

    await vi.waitFor(() => expect(store.getState().orderByChat['a']).toEqual(['a-1']))
    actions.stop()
  })

  it('network ждёт с тем же бэкоффом и повторяет тот же чат, а не пропускает его', async () => {
    const getChats = afterBackgroundSync(async (): Promise<RawChatSummary[]> => [
      { chatId: 'a', name: 'А', type: 'user', unreadCount: 0 },
      { chatId: 'b', name: 'Б', type: 'user', unreadCount: 0 },
    ])
    const calls: string[] = []
    const getChatHistory = vi.fn(async (chatId: string): Promise<RawHistoryItem[]> => {
      calls.push(chatId)
      if (calls.length === 1) throw new ApiError('network')
      return [{ type: 'incoming', idMessage: `${chatId}-1`, timestamp: 1, typeMessage: 'textMessage', chatId, textMessage: 'п' }]
    })
    const { actions, sleeps } = setupPreview(fakeApi({ getChats, getChatHistory }))
    await actions.login(creds, false)
    await actions.syncChatList()

    await vi.waitFor(() => expect(calls).toEqual(['a', 'a', 'b']))
    expect(sleeps[0]).not.toBe(PREVIEW_PAUSE_MS)
    actions.stop()
  })

  it('после PREVIEW_MAX_RETRIES повторов подряд цикл останавливается и остальные чаты не трогает', async () => {
    const getChats = afterBackgroundSync(async (): Promise<RawChatSummary[]> => [
      { chatId: 'a', name: 'А', type: 'user', unreadCount: 0 },
      { chatId: 'b', name: 'Б', type: 'user', unreadCount: 0 },
    ])
    const getChatHistory = vi.fn<GreenApi['getChatHistory']>(async () => {
      throw new ApiError('rateLimit')
    })
    const { actions } = setupPreview(fakeApi({ getChats, getChatHistory }))
    await actions.login(creds, false)
    await actions.syncChatList()

    await vi.waitFor(() => expect(getChatHistory).toHaveBeenCalledTimes(PREVIEW_MAX_RETRIES + 1))
    await new Promise((r) => setTimeout(r, 20))
    expect(getChatHistory).toHaveBeenCalledTimes(PREVIEW_MAX_RETRIES + 1)
    expect(getChatHistory.mock.calls.every((c) => c[0] === 'a')).toBe(true)
    actions.stop()
  })

  it('чат исчез, пока шёл запрос превью: стор не пишется', async () => {
    const getChats = afterBackgroundSync(async (): Promise<RawChatSummary[]> => [{ chatId: 'a', name: 'А', type: 'user', unreadCount: 0 }])
    const d = deferred<RawHistoryItem[]>()
    const getChatHistory = vi.fn(() => d.promise)
    const { store, actions } = setupPreview(fakeApi({ getChats, getChatHistory }))
    await actions.login(creds, false)
    await actions.syncChatList()
    await vi.waitFor(() => expect(getChatHistory).toHaveBeenCalled())

    store.setState({ chats: {}, chatOrder: [] })
    const setStateSpy = vi.spyOn(store, 'setState')
    d.resolve([{ type: 'incoming', idMessage: 'a-1', timestamp: 1, typeMessage: 'textMessage', chatId: 'a', textMessage: 'п' }])
    await new Promise((r) => setTimeout(r, 20))

    expect(setStateSpy).not.toHaveBeenCalled()
    expect(store.getState().messagesById['a-1']).toBeUndefined()
    actions.stop()
  })
})

describe('getChatHistory: один запрос за раз, пауза между запросами, повторы истории', () => {
  const hist = (chatId: string, id: string, timestamp: number): RawHistoryItem =>
    ({ type: 'incoming', idMessage: id, timestamp, typeMessage: 'textMessage', chatId, textMessage: id })

  function setupClock(api: GreenApi) {
    const store: AppStore = createAppStore({ getItem: () => null, setItem: () => {}, removeItem: () => {} })
    let clock = 10_000
    const sleeps: number[] = []
    const actions = createActions({
      store, makeApi: () => api, locks: null, now: () => clock,
      creds: { load: () => null, save: () => {}, clear: () => {} },
      sleep: (ms) => {
        sleeps.push(ms)
        clock += ms
        return Promise.resolve()
      },
    })
    return { store, actions, sleeps, now: () => clock }
  }

  it('openChat во время фонового превью: история ждёт своей очереди и паузы, без 429 и без historyError', async () => {
    const getChats = afterBackgroundSync(async (): Promise<RawChatSummary[]> => [
      { chatId: 'a', name: 'А', type: 'user', unreadCount: 0 },
      { chatId: 'b', name: 'Б', type: 'user', unreadCount: 0 },
    ])
    const preview = deferred<RawHistoryItem[]>()
    let inFlight = 0
    let lastEnd = -Infinity
    let rejected = 0
    const calls: [string, number][] = []
    const clock = { now: () => 0 }
    const getChatHistory = vi.fn(async (chatId: string, count: number): Promise<RawHistoryItem[]> => {
      if (inFlight > 0 || clock.now() - lastEnd < 1000) {
        rejected++
        throw new ApiError('rateLimit')
      }
      calls.push([chatId, count])
      inFlight++
      try {
        if (chatId === 'a' && count === PREVIEW_COUNT) return await preview.promise
        return [hist(chatId, `${chatId}-${count}`, 1)]
      } finally {
        inFlight--
        lastEnd = clock.now()
      }
    })
    const t = setupClock(fakeApi({ getChats, getChatHistory }))
    clock.now = t.now
    await t.actions.login(creds, false)
    await t.actions.syncChatList()
    await vi.waitFor(() => expect(calls).toEqual([['a', PREVIEW_COUNT]]))

    const opening = t.actions.openChat('b')
    await new Promise((r) => setTimeout(r, 10))
    expect(calls).toEqual([['a', PREVIEW_COUNT]])

    preview.resolve([hist('a', 'a-1', 1)])
    await opening

    expect(rejected).toBe(0)
    expect(calls).toEqual([['a', PREVIEW_COUNT], ['b', HISTORY_COUNT]])
    expect(t.sleeps).toContain(HISTORY_GAP_MS)
    expect(t.store.getState().historyError['b']).toBe(false)
    expect(t.store.getState().orderByChat['b']).toEqual([`b-${HISTORY_COUNT}`])
    t.actions.stop()
  })

  it('превью ждёт, пока идёт открытие чата, в том числе его повторы', async () => {
    const getChats = afterBackgroundSync(async (): Promise<RawChatSummary[]> => [
      { chatId: 'a', name: 'А', type: 'user', unreadCount: 0 },
      { chatId: 'b', name: 'Б', type: 'user', unreadCount: 0 },
    ])
    const calls: string[] = []
    let bAttempts = 0
    const getChatHistory = vi.fn(async (chatId: string, count: number): Promise<RawHistoryItem[]> => {
      calls.push(`${chatId}:${count}`)
      if (chatId === 'b' && ++bAttempts === 1) throw new ApiError('rateLimit')
      return [hist(chatId, `${chatId}-${count}`, 1)]
    })
    const t = setupClock(fakeApi({ getChats, getChatHistory }))
    await t.actions.login(creds, false)
    const opening = t.actions.openChat('b')
    await t.actions.syncChatList()
    await opening

    await vi.waitFor(() => expect(calls).toContain(`a:${PREVIEW_COUNT}`))
    expect(calls.slice(0, 2)).toEqual([`b:${HISTORY_COUNT}`, `b:${HISTORY_COUNT}`])
    t.actions.stop()
  })

  it('429 дважды, потом успех: история применяется, баннера ошибки нет', async () => {
    const getChatHistory = vi
      .fn<GreenApi['getChatHistory']>()
      .mockRejectedValueOnce(new ApiError('rateLimit'))
      .mockRejectedValueOnce(new ApiError('network'))
      .mockResolvedValueOnce([hist('10000001', 'h1', 1)])
    const t = setupClock(fakeApi({ getChatHistory }))
    await t.actions.login(creds, false)
    t.store.setState({ chats: { '10000001': { chatId: '10000001', phone: '', title: 'Т', historyLoaded: false } } })
    await t.actions.openChat('10000001')

    expect(getChatHistory).toHaveBeenCalledTimes(3)
    expect(t.store.getState().historyError['10000001']).toBe(false)
    expect(t.store.getState().orderByChat['10000001']).toEqual(['h1'])
    t.actions.stop()
  })

  it('429 на все попытки: после HISTORY_MAX_RETRIES повторов historyError', async () => {
    const getChatHistory = vi.fn<GreenApi['getChatHistory']>(async () => {
      throw new ApiError('rateLimit')
    })
    const t = setupClock(fakeApi({ getChatHistory }))
    await t.actions.login(creds, false)
    t.store.setState({ chats: { '10000001': { chatId: '10000001', phone: '', title: 'Т', historyLoaded: false } } })
    await t.actions.openChat('10000001')

    expect(getChatHistory).toHaveBeenCalledTimes(HISTORY_MAX_RETRIES + 1)
    expect(t.store.getState().historyError['10000001']).toBe(true)
    t.actions.stop()
  })

  it('ошибка не из rateLimit/network не повторяется; новый reloadHistory сразу снимает historyError', async () => {
    const d = deferred<RawHistoryItem[]>()
    const getChatHistory = vi
      .fn<GreenApi['getChatHistory']>()
      .mockRejectedValueOnce(new ApiError('validation'))
      .mockImplementationOnce(() => d.promise)
    const t = setupClock(fakeApi({ getChatHistory }))
    await t.actions.login(creds, false)
    t.store.setState({ chats: { '10000001': { chatId: '10000001', phone: '', title: 'Т', historyLoaded: false } } })
    await t.actions.openChat('10000001')
    expect(getChatHistory).toHaveBeenCalledTimes(1)
    expect(t.store.getState().historyError['10000001']).toBe(true)

    const retry = t.actions.reloadHistory('10000001')
    expect(t.store.getState().historyError['10000001']).toBe(false)
    d.resolve([])
    await retry
    expect(t.store.getState().historyError['10000001']).toBe(false)
    t.actions.stop()
  })
})

describe('reloadHistory: ушли из чата до ответа истории', () => {
  it('открыли A, переключились на B раньше, чем пришла история A: бейдж A 0, новое входящее после ухода даёт 1', async () => {
    const d = deferred<RawHistoryItem[]>()
    const getChatHistory = vi.fn((chatId: string) =>
      chatId === 'a' ? d.promise : Promise.resolve([] as RawHistoryItem[]))
    const t = setup(fakeApi({ getChatHistory }))
    await t.actions.login(creds, false)
    t.store.setState({
      chats: {
        a: { chatId: 'a', phone: '', title: 'А', historyLoaded: false, serverUnread: 2, serverUnreadAt: 0 },
        b: { chatId: 'b', phone: '', title: 'Б', historyLoaded: false },
      },
      chatOrder: ['a', 'b'],
    })

    const openA = t.actions.openChat('a')
    const openB = t.actions.openChat('b')
    d.resolve([
      { type: 'incoming', idMessage: 'h2', timestamp: 6, typeMessage: 'textMessage', chatId: 'a', textMessage: 'два' },
      { type: 'incoming', idMessage: 'h1', timestamp: 5, typeMessage: 'textMessage', chatId: 'a', textMessage: 'раз' },
    ])
    await Promise.all([openA, openB])

    expect(t.store.getState().activeChatId).toBe('b')
    expect(t.store.getState().chats['a']!.readUpTo).toBe(6_000)
    expect(badge(t.store, 'a')).toBe(0)

    t.store.setState(reduceEvent(t.store.getState(), {
      type: 'message', chatType: 'user',
      message: { id: 'n1', chatId: 'a', direction: 'in', text: 'новое', timestamp: 7_000, status: 'sent' },
    }))
    expect(badge(t.store, 'a')).toBe(1)
    t.actions.logout()
  })
})

describe('телефон: мусор из API и старого персиста', () => {
  it('sync лечит старый phone "0" и заголовок "+0": номер из getChats, заголовок из имени', async () => {
    const getChats = vi.fn(async (): Promise<RawChatSummary[]> => [
      { chatId: '10000001', name: 'Иван', phoneNumber: 79990000002, type: 'user', unreadCount: 0 },
    ])
    const t = setup(fakeApi({ getChats }))
    await t.actions.login(creds, false)
    t.store.setState({
      chats: { '10000001': { chatId: '10000001', phone: '0', title: '+0', historyLoaded: false } },
      chatOrder: ['10000001'],
    })
    await t.actions.syncChatList()
    expect(t.store.getState().chats['10000001']).toMatchObject({ phone: '79990000002', title: 'Иван' })
    t.actions.logout()
  })

  it('старый phone "0" и phoneNumber 0 от сервера: телефон становится пустым', async () => {
    const getChats = vi.fn(async (): Promise<RawChatSummary[]> => [
      { chatId: '10000001', name: 'Иван', phoneNumber: 0, type: 'user', unreadCount: 0 },
    ])
    const t = setup(fakeApi({ getChats }))
    await t.actions.login(creds, false)
    t.store.setState({
      chats: { '10000001': { chatId: '10000001', phone: '0', title: '+0', historyLoaded: false } },
      chatOrder: ['10000001'],
    })
    await t.actions.syncChatList()
    expect(t.store.getState().chats['10000001']).toMatchObject({ phone: '', title: 'Иван' })
    t.actions.logout()
  })

  it('уведомление с неправдоподобным номером создаёт чат без телефона и без заголовка «+0»', () => {
    const store = createAppStore({ getItem: () => null, setItem: () => {}, removeItem: () => {} })
    store.setState(reduceEvent(store.getState(), {
      type: 'message', chatType: 'user', peerPhone: '0',
      message: { id: 'x', chatId: '10000001', direction: 'in', text: 'п', timestamp: 1, status: 'sent' },
    }))
    expect(store.getState().chats['10000001']).toMatchObject({ phone: '', title: '10000001' })
  })
})

