import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { OrderProvider } from '@/order/OrderContext'
import { Daemon } from '@/pages/Daemon'
import { Landing } from '@/pages/Landing'
import { NotFound, PrivacyPolicy, Terms } from '@/pages/Policy'
import { Poster } from '@/pages/Poster'
import { Pay } from '@/pay/Pay'
import { useAnalyticsIdentity } from '@/lib/useAnalyticsIdentity'

/**
 * A new route starts at the top of itself — unless it names somewhere else.
 *
 * Without this, moving from halfway down the landing page into another
 * page lands halfway down that one. A hash is honoured rather than
 * ignored, because the redirects below rewrite the URL in place: the
 * browser does no anchor scrolling of its own for a history entry it was
 * handed rather than navigated to.
 */
function ScrollToTop() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (hash) {
      document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' })
      return
    }
    window.scrollTo(0, 0)
  }, [pathname, hash])
  return null
}

export default function App() {
  useAnalyticsIdentity()

  return (
    <BrowserRouter>
      <OrderProvider>
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<Landing />} />
          {/* The old checkout addresses, kept alive. `/order/*` was four
              pages, then four states of a sheet, and is now the paysheet in
              the pricing section — so all four land there. The URLs are in
              inboxes and in the JSON-LD offers and still have to resolve. */}
          <Route path="/order/*" element={<Navigate replace to="/#pricing" />} />
          {/* The phone's payment sheet. The app opens this in an
              authentication session because `react-native-razorpay` cannot
              be linked into an iOS build (SwiftUICore, round seven); the
              page opens Razorpay Checkout and ends on `lyzn://order/<ref>`.
              See src/pay/params.ts for why the URL carries no secret. */}
          <Route path="/pay" element={<Pay />} />
          {/* The desktop app's download page. The installers it links to are
              files on this same origin under /downloads, put there by the
              desktop workflow — see src/data/daemon.ts. */}
          <Route path="/daemon" element={<Daemon />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<Terms />} />
          {/* The poster renderer. Development only — see src/pages/Poster.tsx. */}
          {import.meta.env.DEV && <Route path="/poster" element={<Poster />} />}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </OrderProvider>
    </BrowserRouter>
  )
}
