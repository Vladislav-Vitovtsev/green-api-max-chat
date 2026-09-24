import { createGreenApi } from './greenApi'
import { ApiError } from './errors'

const creds = { apiUrl: 'https://3100.api.green-api.com/', idInstance: ' 3100 ', apiTokenInstance: 'SECRET' }

function fakeFetch(status: number, body: string) {
  const calls: { url: string; init: RequestInit }[] = []
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(body, { status })
  }) as unknown as typeof fetch
  return { impl, calls }
}

describe('createGreenApi', () => {
  it('собирает URL без двойных слэшей и пробелов', async () => {
    const f = fakeFetch(200, '{"stateInstance":"authorized"}')
    const api = createGreenApi(creds, f.impl)
    await expect(api.getStateInstance()).resolves.toBe('authorized')
    expect(f.calls[0]!.url).toBe('https://3100.api.green-api.com/waInstance3100/getStateInstance/SECRET')
    expect(f.calls[0]!.init.method).toBe('GET')
  })

  it('sendMessage шлёт POST с JSON', async () => {
    const f = fakeFetch(200, '{"idMessage":"m1"}')
    const api = createGreenApi(creds, f.impl)
    await expect(api.sendMessage('10000000', 'привет')).resolves.toEqual({ idMessage: 'm1' })
    expect(f.calls[0]!.init.method).toBe('POST')
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ chatId: '10000000', message: 'привет' })
  })

  it('receiveNotification: null при пустом ответе и receiveTimeout в query', async () => {
    const f = fakeFetch(200, 'null')
    const api = createGreenApi(creds, f.impl)
    await expect(api.receiveNotification(20)).resolves.toBeNull()
    expect(f.calls[0]!.url).toMatch(/receiveNotification\/SECRET\?receiveTimeout=20$/)
  })

  it('deleteNotification шлёт DELETE с receiptId', async () => {
    const f = fakeFetch(200, '{"result":true}')
    const api = createGreenApi(creds, f.impl)
    await api.deleteNotification(42)
    expect(f.calls[0]!.url).toMatch(/deleteNotification\/SECRET\/42$/)
    expect(f.calls[0]!.init.method).toBe('DELETE')
  })

  it('checkAccount: phoneNumber числом', async () => {
    const f = fakeFetch(200, '{"exist":true,"chatId":"10000000"}')
    const api = createGreenApi(creds, f.impl)
    await expect(api.checkAccount('79991234567')).resolves.toEqual({ exist: true, chatId: '10000000' })
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ phoneNumber: 79991234567 })
  })

  it('checkAccount: status:false с лимитом → rateLimit', async () => {
    const f = fakeFetch(200, '{"status":false,"reason":"User get contact info limit reached"}')
    const api = createGreenApi(creds, f.impl)
    await expect(api.checkAccount('79991234567')).rejects.toMatchObject({ kind: 'rateLimit' })
  })

  it('checkAccount: status:false не авторизован → notAuthorized', async () => {
    const f = fakeFetch(200, '{"status":false,"reason":"instance is starting or not authorized"}')
    const api = createGreenApi(creds, f.impl)
    await expect(api.checkAccount('79991234567')).rejects.toMatchObject({ kind: 'notAuthorized' })
  })

  it('checkAccount: status:false с секретом в reason → unknown, токена в тексте нет', async () => {
    const f = fakeFetch(200, '{"status":false,"reason":"oops SECRET"}')
    const api = createGreenApi(creds, f.impl)
    const err = await api.checkAccount('79991234567').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).kind).toBe('unknown')
    expect((err as ApiError).message).not.toContain('SECRET')
  })

  it('HTTP 401 → unauthorized, токена нет в тексте ошибки', async () => {
    const f = fakeFetch(401, 'bad token SECRET')
    const api = createGreenApi(creds, f.impl)
    const err = await api.getStateInstance().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).kind).toBe('unauthorized')
    expect((err as ApiError).message).not.toContain('SECRET')
  })

  it('сетевой сбой → network, токена нет в тексте', async () => {
    const impl = (async () => {
      throw new TypeError('Failed to fetch https://x/waInstance3100/getStateInstance/SECRET')
    }) as unknown as typeof fetch
    const err = await createGreenApi(creds, impl).getStateInstance().catch((e: unknown) => e)
    expect((err as ApiError).kind).toBe('network')
    expect((err as ApiError).message).not.toContain('SECRET')
  })

  it('AbortError пробрасывается как есть', async () => {
    const impl = (async () => {
      throw new DOMException('aborted', 'AbortError')
    }) as unknown as typeof fetch
    const err = await createGreenApi(creds, impl).getStateInstance().catch((e: unknown) => e)
    expect((err as Error).name).toBe('AbortError')
  })

  it('getChatHistory: пустой ответ → []', async () => {
    const f = fakeFetch(200, '')
    await expect(createGreenApi(creds, f.impl).getChatHistory('1', 100)).resolves.toEqual([])
  })

  it('некорректный JSON в ответе 200 → unknown', async () => {
    const f = fakeFetch(200, '{not json')
    const err = await createGreenApi(creds, f.impl).getStateInstance().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).kind).toBe('unknown')
  })

  it('receiveNotification: внешний AbortController обрывает через combined signal', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const impl = ((_url: string, init: RequestInit) => {
      calls.push({ url: _url, init })
      return new Promise((_, reject) => {
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason))
      })
    }) as unknown as typeof fetch
    const api = createGreenApi(creds, impl)
    const controller = new AbortController()
    const promise = api.receiveNotification(20, controller.signal)
    controller.abort()
    const err = await promise.catch((e: unknown) => e)
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal)
    expect((err as Error).name).toBe('AbortError')
  })

  it('receiveNotification: fetch реджектится TimeoutError → network', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const impl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      throw new DOMException('t', 'TimeoutError')
    }) as unknown as typeof fetch
    const api = createGreenApi(creds, impl)
    const err = await api.receiveNotification(20).catch((e: unknown) => e)
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).kind).toBe('network')
  })
})
