import type { StateStorage } from 'zustand/middleware'
import type { GreenApi } from '../api/greenApi'
import type { Message } from '../core/model'
import { createActions } from './actions'
import { createAppStore } from './store'

const creds = { apiUrl: 'https://api.green-api.com', idInstance: '1', apiTokenInstance: 't' }

function preloadedStorage(
  messagesById: Record<string, Message>,
  chats: Record<string, unknown> = {},
  chatOrder: string[] = [],
  orderByChat: Record<string, string[]> = {},
): StateStorage {
  const raw = JSON.stringify({
    state: { chats, chatOrder, messagesById, orderByChat, ownerId: '1' },
    version: 2,
  })
  return { getItem: () => raw, setItem: () => {}, removeItem: () => {} }
}

describe('createAppStore — rehydrate', () => {
  it('зависший pending-статус после rehydrate становится failed', () => {
    const pending: Message = { id: 'm1', chatId: '10000001', direction: 'out', text: 'привет', timestamp: 1, status: 'pending' }
    const store = createAppStore(preloadedStorage({ m1: pending }))
    expect(store.getState().messagesById.m1?.status).toBe('failed')
  })

  it('не трогает уже финальные статусы', () => {
    const sent: Message = { id: 'm2', chatId: '10000001', direction: 'out', text: 'привет', timestamp: 1, status: 'sent' }
    const store = createAppStore(preloadedStorage({ m2: sent }))
    expect(store.getState().messagesById.m2?.status).toBe('sent')
  })

  it('после rehydrate retryMessage принимает бывший pending (он уже failed, не возвращается рано)', async () => {
    const pending: Message = { id: 'local-1', chatId: '10000001', direction: 'out', text: 'привет', timestamp: 1, status: 'pending' }
    const chats = { '10000001': { chatId: '10000001', phone: '79990000001', title: '+7 999 000-00-01', historyLoaded: true } }
    const store = createAppStore(preloadedStorage({ 'local-1': pending }, chats, ['10000001'], { '10000001': ['local-1'] }))
    expect(store.getState().messagesById['local-1']?.status).toBe('failed')

    const sendMessage = vi.fn(async () => ({ idMessage: 'm2' }))
    const api: GreenApi = {
      getStateInstance: vi.fn(async () => 'authorized'),
      sendMessage,
      getChatHistory: vi.fn(async () => []),
      checkAccount: vi.fn(async () => ({ exist: true, chatId: '10000001' })),
      receiveNotification: vi.fn(() => new Promise<null>(() => {})),
      deleteNotification: vi.fn(async () => {}),
      getChats: vi.fn(async () => []),
      lastIncomingMessages: vi.fn(async () => []),
      lastOutgoingMessages: vi.fn(async () => []),
    }
    const actions = createActions({
      store,
      makeApi: () => api,
      locks: null,
      creds: { load: () => null, save: () => {}, clear: () => {} },
    })
    await actions.login(creds, false)
    await actions.retryMessage('local-1')
    expect(sendMessage).toHaveBeenCalledWith('10000001', 'привет')
    actions.logout()
  })
})

describe('createAppStore — запись персиста только из активной вкладки', () => {
  function sharedStorage(): StateStorage & { raw: string | null } {
    const st = {
      raw: null as string | null,
      getItem: () => st.raw,
      setItem: (_k: string, v: string) => void (st.raw = v),
      removeItem: () => void (st.raw = null),
    }
    return st
  }
  const chat = { chatId: '10000001', phone: '79990000001', title: '+7 999 000-00-01', historyLoaded: true }

  it('запись выключена по умолчанию; setPersistWritable(false) превращает запись и очистку персиста в no-op', () => {
    const storage = sharedStorage()
    const store = createAppStore(storage)
    store.setState({ chats: { '10000001': chat }, chatOrder: ['10000001'] })
    expect(storage.raw).toBeNull()
    store.setPersistWritable(true)
    store.setState({ chats: { '10000001': chat }, chatOrder: ['10000001'] })
    const written = storage.raw
    expect(written).toContain('10000001')

    store.setPersistWritable(false)
    store.setState({ chats: {}, chatOrder: [] })
    store.persist.clearStorage()
    expect(storage.raw).toBe(written)

    store.setPersistWritable(true)
    store.setState({ connection: 'idle' })
    expect(storage.raw).not.toContain('10000001')
  })

  it('rehydrate подтягивает данные, записанные другой вкладкой, и переводит её pending в failed', async () => {
    const storage = sharedStorage()
    const reader = createAppStore(storage)
    const writer = createAppStore(storage)
    writer.setPersistWritable(true)
    const pending: Message = { id: 'local-1', chatId: '10000001', direction: 'out', text: 'привет', timestamp: 1, status: 'pending' }
    writer.setState({
      chats: { '10000001': chat },
      chatOrder: ['10000001'],
      messagesById: { 'local-1': pending },
      orderByChat: { '10000001': ['local-1'] },
      ownerId: '1',
    })

    await reader.persist.rehydrate()
    expect(reader.getState().chats['10000001']).toBeDefined()
    expect(reader.getState().ownerId).toBe('1')
    expect(reader.getState().messagesById['local-1']?.status).toBe('failed')
  })

  it('rehydrate выбрасывает мусорный телефон "0" из старого персиста, нормальный оставляет', async () => {
    const storage = sharedStorage()
    storage.raw = JSON.stringify({
      version: 2,
      state: {
        chats: {
          '10000001': { chatId: '10000001', phone: '0', title: '+0', historyLoaded: false },
          '10000002': { ...chat, chatId: '10000002' },
        },
        chatOrder: ['10000001', '10000002'], messagesById: {}, orderByChat: {}, ownerId: '1',
      },
    })
    const store = createAppStore(storage)
    await store.persist.rehydrate()
    expect(store.getState().chats['10000001']!.phone).toBe('')
    expect(store.getState().chats['10000002']!.phone).toBe('79990000001')
  })
})
