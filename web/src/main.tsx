import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import { colors, fonts } from '@lyzn/design'
import App from './App'
import { CLERK_PUBLISHABLE_KEY } from './lib/env'
import { initAnalytics } from './lib/posthog'
import './index.css'

initAnalytics()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      afterSignOutUrl="/"
      appearance={{
        variables: {
          colorPrimary: colors.inkFg,
          colorBackground: colors.paper,
          colorText: colors.inkFg,
          fontFamily: fonts.web.sans,
          borderRadius: '10px',
        },
      }}
    >
      <App />
    </ClerkProvider>
  </StrictMode>,
)
