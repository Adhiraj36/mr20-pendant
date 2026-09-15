// A reply, typeset.
//
// react-markdown with GitHub's extensions, the same pairing t3code renders its
// transcript with (https://github.com/pingdotgg/t3code, MIT). Raw HTML is not
// enabled: a reply is the model's words, and this page holds a bridge that can
// run shell commands, so nothing in a reply gets to be markup.
import { memo, useEffect, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/util'
import { highlight } from '@/routes/chat/highlight'

type HastNode = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] }

const textOf = (n: HastNode | undefined): string =>
  !n ? '' : n.type === 'text' ? (n.value ?? '') : (n.children ?? []).map(textOf).join('')

export function CodeBlock({ code, lang, maxHeight }: { code: string; lang: string; maxHeight?: number }) {
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let live = true
    void highlight(code, lang).then((h) => {
      if (live) setHtml(h)
    })
    return () => {
      live = false
    }
  }, [code, lang])

  const body = maxHeight ? { maxHeight, overflowY: 'auto' as const } : undefined

  return (
    <div className="md-code">
      <div className="md-code-head">
        <span>{lang && lang !== 'text' ? lang : ''}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(code)
            setCopied(true)
            setTimeout(() => setCopied(false), 1400)
          }}
          aria-label={copied ? 'Copied' : 'Copy code'}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      {/* Until the grammar loads, the same text unhighlighted — never a blank
          block that pops in. */}
      {html ? (
        <div className="md-code-body selectable" style={body} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="md-code-body selectable" style={body}>
          <pre>
            <code>{code}</code>
          </pre>
        </div>
      )}
    </div>
  )
}

const external = (href: string) => /^(https?:|mailto:)/i.test(href)

const components: Components = {
  pre({ node }) {
    const code = (node as HastNode | undefined)?.children?.find((c) => c.tagName === 'code')
    const cls = code?.properties?.className
    const lang = (Array.isArray(cls) ? cls : [])
      .map(String)
      .find((c) => c.startsWith('language-'))
      ?.slice('language-'.length)
    return <CodeBlock code={textOf(code).replace(/\n$/, '')} lang={lang ?? ''} />
  },
  a({ href, children }) {
    if (!href || !external(href)) return <span className="md-link-dead">{children}</span>
    return (
      <a
        href={href}
        title={href}
        onClick={(e) => {
          e.preventDefault()
          void window.karmax.app.openExternal(href)
        }}
      >
        {children}
      </a>
    )
  },
  table({ children }) {
    return (
      <div className="md-table">
        <table>{children}</table>
      </div>
    )
  },
  // The page's CSP loads no remote image, so a picture in a reply is offered
  // as the link it would have been fetched from.
  img({ src, alt }) {
    const href = typeof src === 'string' ? src : ''
    return external(href) ? (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault()
          void window.karmax.app.openExternal(href)
        }}
      >
        {alt || href}
      </a>
    ) : (
      <span>{alt}</span>
    )
  },
}

const plugins = [remarkGfm]

export const Markdown = memo(function Markdown({
  text,
  streaming,
  className,
}: {
  text: string
  streaming?: boolean
  className?: string
}) {
  return (
    <div className={cn('md selectable', streaming && 'md-streaming', className)}>
      <ReactMarkdown remarkPlugins={plugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
