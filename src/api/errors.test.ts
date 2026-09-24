import { ApiError, errorFromResponse, isAbortError, toApiError } from './errors'
import { maskSecret } from './mask'

describe('errorFromResponse', () => {
  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [429, 'rateLimit'],
    [469, 'rateLimit'],
    [466, 'quota'],
    [400, 'validation'],
    [500, 'network'],
    [502, 'network'],
    [418, 'unknown'],
  ] as const)('%i → %s', (status, kind) => {
    const err = errorFromResponse(status, 'body')
    expect(err).toBeInstanceOf(ApiError)
    expect(err.kind).toBe(kind)
    expect(err.status).toBe(status)
  })
})

describe('isAbortError', () => {
  it('узнаёт AbortError и не путает с TimeoutError', () => {
    expect(isAbortError(new DOMException('x', 'AbortError'))).toBe(true)
    expect(isAbortError(new DOMException('x', 'TimeoutError'))).toBe(false)
    expect(isAbortError(new Error('x'))).toBe(false)
  })
})

describe('maskSecret', () => {
  it('заменяет все вхождения секрета', () => {
    expect(maskSecret('a/TOKEN/b?x=TOKEN', 'TOKEN')).toBe('a/***/b?x=***')
  })
  it('не трогает текст при пустом секрете', () => {
    expect(maskSecret('abc', '')).toBe('abc')
  })
})

describe('toApiError', () => {
  it('ApiError проходит без изменений (identity)', () => {
    const original = new ApiError('quota', 'msg', 466)
    expect(toApiError(original)).toBe(original)
  })

  it('Error → kind unknown с исходным сообщением', () => {
    const err = toApiError(new Error('boom'))
    expect(err).toBeInstanceOf(ApiError)
    expect(err.kind).toBe('unknown')
    expect(err.message).toBe('boom')
  })

  it('строка → kind unknown', () => {
    const err = toApiError('oops')
    expect(err).toBeInstanceOf(ApiError)
    expect(err.kind).toBe('unknown')
  })
})
