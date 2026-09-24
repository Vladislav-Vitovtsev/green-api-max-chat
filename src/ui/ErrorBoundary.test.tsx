// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary'

function Boom(): never {
  throw new Error('текст ошибки, который не должен попасть в лог')
}

it('componentDidCatch логирует категорию ошибки, а не сырое сообщение', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  render(
    <ErrorBoundary>
      <Boom />
    </ErrorBoundary>,
  )
  expect(screen.getByText('Что-то пошло не так')).toBeInTheDocument()
  expect(error).toHaveBeenCalledWith('[ui]', 'unknown')
  error.mockRestore()
})
