// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { StatusIcon } from './MessageBubble'
import { IconPlus } from './icons'

it('иконка со статусом доступна через getByLabelText', () => {
  render(<StatusIcon status="sent" />)
  expect(screen.getByLabelText('Отправлено')).toBeInTheDocument()
})

it('иконка со статусом доступна через getByRole("img", { name })', () => {
  render(<StatusIcon status="read" />)
  expect(screen.getByRole('img', { name: 'Прочитано' })).toBeInTheDocument()
})

it('декоративная иконка без aria-label остаётся aria-hidden и не видна в доступном дереве', () => {
  render(<IconPlus />)
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(document.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
})
