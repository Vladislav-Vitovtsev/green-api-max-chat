import { Component, type ReactNode } from 'react'
import { toApiError } from '../api/errors/errors'
import { texts } from '../ui/lib/texts'

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.error('[ui]', toApiError(error).kind)
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div>
          <p>{texts.fatal.title}</p>
          <button type="button" onClick={() => location.reload()}>{texts.fatal.reload}</button>
        </div>
      </div>
    )
  }
}
