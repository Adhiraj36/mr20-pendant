// What a broken screen says instead of going white.
//
// A render that throws takes the whole window with it: React unmounts the tree
// and Electron is left showing nothing at all. On a page that is somebody's
// only way to see whether their laptop is working, a blank window is the worst
// possible answer — it is indistinguishable from the app being dead, and it
// tells whoever is trying to help exactly nothing.
//
// So a failure keeps the window, says which screen broke, and offers the two
// things that actually help: going back to somewhere that works, and the error
// itself, in text somebody can paste into a message.
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button, CopyButton, Panel } from '@/components/ui'

interface Props {
  children: ReactNode
  /** Which screen this is guarding, for the message and for the log. */
  where: string
  /** Somewhere known-good to send them, when there is one. */
  onEscape?: () => void
}

interface State {
  error: Error | null
}

export class Boundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The renderer's console is not somewhere a person can reach, so this also
    // goes to the main process, which writes the log the support path uses.
    console.error(`[${this.props.where}]`, error, info.componentStack)
    void window.karmax.app.reportError?.({
      where: this.props.where,
      message: error.message,
      stack: `${error.stack ?? ''}\n${info.componentStack ?? ''}`.trim(),
    })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const detail = `${this.props.where}: ${error.message}\n${error.stack ?? ''}`.trim()
    return (
      <div className="p-6">
        <Panel>
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" style={{ color: 'var(--bad)' }} />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold">This screen could not be drawn.</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--fg-dim)]">
                The rest of the app is fine, and your assistant keeps running. Going back and
                returning usually clears it.
              </p>
              <p className="selectable mt-3 break-words font-mono text-[11.5px] text-[var(--fg-faint)]">
                {error.message}
              </p>
              <div className="mt-4 flex gap-2">
                {this.props.onEscape && (
                  <Button variant="primary" size="sm" onClick={this.props.onEscape}>
                    Back to the overview
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => this.setState({ error: null })}>
                  Try again
                </Button>
                <CopyButton value={detail} label="Copy the details" />
              </div>
            </div>
          </div>
        </Panel>
      </div>
    )
  }
}
