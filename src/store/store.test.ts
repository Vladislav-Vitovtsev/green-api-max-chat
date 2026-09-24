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
    const pending: Message = { id: 'm1', chatId: '10000001', direction: 'out', text: 'привет', timestamp: 1, status: 'pending' }
    const chats = { '10000001': { chatId: '10000001', phone: '79990000001', title: '+7 999 000-00-01', historyLoaded: true } }
    const store = createAppStore(preloadedStorage({ m1: pending }, chats, ['10000001'], { '10000001': ['m1'] }))
    expect(store.getState().messagesById.m1?.status).toBe('failed')

    const sendMessage = vi.fn(async () => ({ idMessage: 'm2' }))
    const api: GreenApi = {
      getStateInstance: vi.fn(async () => 'authorized'),
      sendMessage,
      getChatHistory: vi.fn(async () => []),
      checkAccount: vi.fn(async () => ({ exist: true, chatId: '10000001' })),
      receiveNotification: vi.fn(() => new Promise<null>(() => {})),
      deleteNotification: vi.fn(async () => {}),
    }
    const actions = createActions({
      store,
      makeApi: () => api,
      locks: null,
      creds: { load: () => null, save: () => {}, clear: () => {} },
    })
    await actions.login(creds, false)
    await actions.retryMessage('m1')
    expect(sendMessage).toHaveBeenCalledWith('10000001', 'привет')
    actions.logout()
  })
})
