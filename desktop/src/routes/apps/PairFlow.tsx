// The flows that are a command-line ritual underneath.
//
// wacli prints a QR; gws prints a consent URL. Both are streamed here so the
// person sees a code to scan or a link to click, rather than being told to open
// a terminal.
//
// And if the tool the ritual needs is not on the machine, this installs it
// first, in the same window, without asking. Somebody who pressed "Connect
// WhatsApp" wants WhatsApp connected; being handed a link to a Go toolchain is
// a dead end wearing the clothes of an answer.
import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'
import type { HostAction } from '@shared/types'
import { Button } from '@/components/ui'
import { Modal } from '@/components/Overlays'
import { QrBlocks, findQrBlock } from '@/routes/apps/QrBlocks'

/** A URL in a stream of console output. The consent link gws prints is the one
 *  thing on that screen a person has to act on, so it gets lifted out of the
 *  log and turned into a button. */
function findUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s'"<>]+/)
  return m ? m[0] : null
}

export function PairFlow({
  open,
  onClose,
  action,
  title,
  lede,
  instructions,
  requires,
  connects,
  onFinished,
}: {
  open: boolean
  onClose: () => void
  action: HostAction
  title: string
  lede: string
  instructions: string
  /** The tool this flow cannot run without. Installed first when missing. */
  requires?: { id: string; install: HostAction; name: string }
  /** Bring a connection up once the ritual succeeds — WhatsApp is not
   *  connected by pairing, only by the daemon that pairing tells you to run. */
  connects?: 'whatsapp' 
  onFinished?: (ok: boolean) => void
}) {
  const [output, setOutput] = useState('')
  const [image, setImage] = useState<string | null>(null)
  const [done, setDone] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  /** After the pairing: bringing the connection up, then up. */
  const [connecting, setConnecting] = useState(false)
  const [connected, setConnected] = useState(false)
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (!open) return
    setOutput('')
    setImage(null)
    setDone(null)
    setError(null)
    setInstalling(false)
    setConnected(false)
    setConnecting(false)

    let cancelled = false
    // Which action the stream currently belongs to: an install runs first and
    // its "done" must not be reported as the pairing having finished.
    let stage: HostAction = action

    const off = window.karmax.host.onChunk((c) => {
      if (c.id !== stage) return
      if (c.image) setImage(c.image)
      if (c.text) setOutput((o) => (o + c.text).slice(-8000))
      if (!c.done) return

      if (stage === requires?.install) {
        if (!c.ok) {
          setError(`Could not install ${requires.name}.`)
          setDone(false)
          return
        }
        // Installed. Straight on to what the person actually asked for.
        setInstalling(false)
        setOutput((o) => o + `\n${requires.name} is ready.\n\n`)
        stage = action
        void window.karmax.host.run(action).then((r) => {
          if (!r.ok && !cancelled) {
            setError(r.error ?? 'Could not start.')
            setDone(false)
          }
        })
        return
      }

      setDone(c.ok ?? false)
      onFinished?.(c.ok ?? false)

      // Pairing hands back a phone that is linked and a machine that is not
      // listening. Starting the daemon is the difference between "scanned" and
      // "working", so it happens here rather than being left as an
      // instruction in a log nobody reads.
      if (c.ok && connects === 'whatsapp') {
        setConnecting(true)
        void window.karmax.whatsapp
          .connect()
          .then((r) => setConnected(r.running))
          .finally(() => setConnecting(false))
      }
    })

    const begin = async () => {
      // Ask the machine rather than assuming: somebody may have installed it
      // themselves between opening this window and now.
      if (requires) {
        const checks = await window.karmax.host.environment()
        const have = checks.find((c) => c.id === requires.id)
        if (have && !have.ok) {
          if (have.installable === false) {
            setError(
              have.needs
                ? `${requires.name} needs ${have.needs} on this machine first.`
                : `${requires.name} is not installed.`,
            )
            setDone(false)
            return
          }
          stage = requires.install
          setInstalling(true)
        }
      }
      if (cancelled) return
      const r = await window.karmax.host.run(stage)
      if (!r.ok && !cancelled) {
        setError(r.error ?? 'Could not start.')
        setDone(false)
      }
    }
    void begin()

    return () => {
      cancelled = true
      off()
      void window.karmax.host.cancel()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, action])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [output])

  const url = findUrl(output)
  // wacli writes a PNG only when `qrencode` happens to be installed. When it
  // has not, the code is still there — printed as half-blocks — and reading it
  // back beats showing somebody a smear in a log pane.
  const qrRows = image ? null : findQrBlock(output)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      lede={lede}
      wide
      footer={
        <>
          {done === null && (
            <span className="mr-auto flex items-center gap-2 text-[12.5px] text-[var(--fg-dim)]">
              <Loader2 size={14} className="animate-spin" />
              {installing && requires ? `Installing ${requires.name}…` : 'Waiting…'}
            </span>
          )}
          {done === true && (
            <span className="mr-auto text-[12.5px]" style={{ color: connected || !connects ? 'var(--ok)' : 'var(--fg-dim)' }}>
              {!connects
                ? 'Done.'
                : connecting
                  ? 'Paired. Connecting and syncing your chats…'
                  : connected
                    ? 'Connected. Your chats are syncing in the background.'
                    : 'Paired, but the connection did not come up. Try Apps → WhatsApp again.'}
            </span>
          )}
          {done === false && (
            <span className="mr-auto text-[12.5px] text-[var(--bad)]">
              {error ?? 'That did not finish. The output below says why.'}
            </span>
          )}
          <Button variant="quiet" onClick={onClose}>
            {done === null ? 'Cancel' : 'Close'}
          </Button>
        </>
      }
    >
      <p className="text-[13.5px] leading-relaxed text-[var(--fg-dim)]">{instructions}</p>

      {image && (
        <div className="mt-5 flex justify-center">
          <img
            src={image}
            alt="Pairing QR code"
            className="border bg-white p-3"
            style={{ width: 236, height: 236, imageRendering: 'pixelated' }}
          />
        </div>
      )}

      {qrRows && done === null && (
        <div className="mt-5 flex flex-col items-center">
          <div className="border">
            <QrBlocks rows={qrRows} size={248} />
          </div>
          <p className="mt-2.5 text-[12px] text-[var(--fg-faint)]">
            Scan this with WhatsApp → Linked devices
          </p>
        </div>
      )}

      {url && (
        <div className="mt-5 border bg-[var(--skin-1)] p-4">
          <p className="text-[13px] font-medium">Open this to sign in</p>
          <p className="selectable mt-1 break-all font-mono text-[11.5px] text-[var(--fg-dim)]">{url}</p>
          <Button
            variant="primary"
            size="sm"
            className="mt-3"
            icon={<ExternalLink size={13} />}
            onClick={() => void window.karmax.app.openExternal(url)}
          >
            Open in my browser
          </Button>
        </div>
      )}

      {output && (
        <details className="mt-5" open={!image && !url}>
          <summary className="cursor-pointer text-[12.5px] text-[var(--fg-dim)]">Output</summary>
          <pre
            ref={logRef}
            className="selectable mt-2 max-h-[260px] overflow-auto border bg-[var(--ink-deep)]/60 p-3 font-mono text-[11px] leading-[1.15] whitespace-pre"
          >
            {output}
          </pre>
        </details>
      )}
    </Modal>
  )
}
