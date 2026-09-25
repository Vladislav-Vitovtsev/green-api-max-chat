import '@maxhub/max-ui/dist/styles.css'
import './ui/styles/theme.css'
import { MaxUI } from '@maxhub/max-ui'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { ErrorBoundary } from './app/ErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MaxUI className="app-root" colorScheme="dark" platform="ios">
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </MaxUI>
  </StrictMode>,
)
