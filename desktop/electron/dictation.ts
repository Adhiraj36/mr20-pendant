// Dictation, in the main process.
//
// The helper is its own small macOS app (native/dictate) because macOS grants
// the microphone and speech recognition to a bundle. This spawns it, turns its
// JSON lines into events for the window, and is the only thing that stops it.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { DictationEvent } from './shared/types.js'

function helperPath(): string {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'dictate')
    : path.join(app.getAppPath(), 'resources', 'dictate')
  return path.join(base, 'LYZN Dictation.app', 'Contents', 'MacOS', 'lyzn-dictate')
}

export class DictationRunner extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null

  available(): boolean {
    return process.platform === 'darwin' && fs.existsSync(helperPath())
  }

  start(): { ok: boolean; error?: string } {
    if (this.child) return { ok: true }
    if (!this.available()) return { ok: false, error: 'Dictation is not available on this machine.' }

    const child = spawn(helperPath(), [], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child
    let buffer = ''
    let settled = false

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      let cut = buffer.indexOf('\n')
      while (cut >= 0) {
        const line = buffer.slice(0, cut).trim()
        buffer = buffer.slice(cut + 1)
        cut = buffer.indexOf('\n')
        if (!line) continue
        try {
          const event = JSON.parse(line) as DictationEvent
          if (event.type === 'final' || event.type === 'error') settled = true
          this.emit('event', event)
        } catch {
          // Half a line from a helper that was killed mid-write.
        }
      }
    })
    child.stderr.resume()
    child.stdin.on('error', () => {})

    child.on('error', () => {
      settled = true
      this.emit('event', { type: 'error', code: 'failed', message: 'Dictation could not start.' })
    })
    child.on('exit', () => {
      if (this.child === child) this.child = null
      // A helper that died without a word must still hand the composer back.
      if (!settled) this.emit('event', { type: 'error', code: 'failed', message: 'Dictation stopped unexpectedly.' })
      this.emit('event', { type: 'end' })
    })
    return { ok: true }
  }

  stop(): void {
    this.child?.stdin.write('stop\n')
  }

  cancel(): void {
    const child = this.child
    if (!child) return
    child.stdin.write('cancel\n')
    setTimeout(() => child.kill('SIGTERM'), 1500).unref()
  }

  dispose(): void {
    this.child?.kill('SIGTERM')
  }
}
