import '@maxhub/max-ui/dist/styles.css'
import './ui/theme.css'
import { MaxUI } from '@maxhub/max-ui'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import { ErrorBoundary } from './ui/ErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MaxUI colorScheme="dark" platform="ios">
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </MaxUI>
  </StrictMode>,
)
