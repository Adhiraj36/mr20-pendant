import { useCallback, useEffect, useState } from 'react'
import type { SetupState } from '@shared/types'
import { Scroller, Sidebar, TitleBar, type Route } from '@/components/Chrome'
import { Boundary } from '@/components/Boundary'
import { ToastHost } from '@/components/Overlays'
import { Spinner } from '@/components/ui'
import { useDaemon } from '@/lib/hooks'
import { useQuestions } from '@/lib/questions'
import Mira from '@/routes/Mira'
import Dashboard from '@/routes/Dashboard'
import Apps from '@/routes/Apps'
import Tasks from '@/routes/Tasks'
import Loops from '@/routes/Loops'
import Memory from '@/routes/Memory'
import SettingsPage from '@/routes/Settings'
import Setup from '@/routes/Setup'

export default function App() {
  const [route, setRoute] = useState<Route>('mira')
  const [setup, setSetup] = useState<SetupState | null>(null)
  /** Whether this machine is signed in to LYZN. Null until we have asked. */
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [theme, setTheme] = useState(() => localStorage.getItem('lyzn.theme') ?? 'light')
  const status = useDaemon()
  const questions = useQuestions(signedIn === true && setup?.needsSetup === false, () => setRoute('tasks'))

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('lyzn.theme', theme)
  }, [theme])

  const refreshSetup = useCallback(() => {
    void window.karmax.setup.state().then(setSetup)
    void window.karmax.lyzn.pairing().then((p) => setSignedIn(p.paired))
  }, [])

  useEffect(refreshSetup, [refreshSetup])

  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])

  return (
    <ToastHost>
      <div className="flex h-full flex-col">
        <TitleBar theme={theme} onTheme={toggleTheme} />

        {setup === null || signedIn === null ? (
          <div className="grid flex-1 place-items-center">
            <Spinner />
          </div>
        ) : setup.needsSetup || !signedIn ? (
          /* No pairing, no app. This window is one half of LYZN and it does
             nothing on its own: the work it carries out, the memory it reads
             and the receipts it prints all belong to an account. A machine
             that is not signed in has nothing to show and nothing to do, so
             it is shown the way in rather than an empty dashboard — and that
             is true whether it never signed in or was signed out later. */
          <Setup
            state={setup}
            onDone={refreshSetup}
            signInOnly={!setup.needsSetup && !signedIn}
          />
        ) : (
          <div className="flex min-h-0 flex-1">
            <Sidebar route={route} onRoute={setRoute} status={status} badges={{ tasks: questions.length }} />
            <Scroller bleed={route === 'mira' || route === 'tasks' || route === 'loops' || route === 'dashboard'}>
              {/* Keyed by route, so leaving a screen that broke and coming
                  back gives it a fresh try rather than the same error. */}
              <Boundary key={route} where={route} onEscape={() => setRoute('mira')}>
                {route === 'mira' && <Mira onRoute={setRoute} />}
                {route === 'dashboard' && <Dashboard status={status} onRoute={setRoute} />}
                {route === 'tasks' && <Tasks />}
                {route === 'apps' && <Apps status={status} />}
                {route === 'loops' && <Loops status={status} />}
                {route === 'memory' && <Memory status={status} />}
                {route === 'settings' && <SettingsPage status={status} setup={setup} />}
              </Boundary>
            </Scroller>
          </div>
        )}
      </div>
    </ToastHost>
  )
}
