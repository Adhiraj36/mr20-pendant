import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Footer } from '@/components/Footer'
import { Nav } from '@/components/Nav'
import {
  CONTACT_EMAIL,
  PAYMENT_TERMS,
  PRIVACY,
  PRIVACY_ACCESS,
  PRIVACY_DELETE,
  PRIVACY_RETENTION,
} from '@/data/content'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

/**
 * The two text pages, in the same paper as the pricing section.
 *
 * They exist because the landing page links to them and a link that goes
 * nowhere is worse than no link. What they contain is exactly what the
 * product has confirmed — no more. Where a policy needs an answer nobody
 * has given yet, the page says so rather than filling the gap with the
 * usual reassuring sentences.
 */
function Policy({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="on-paper min-h-screen bg-tone-bg">
      <Nav variant="checkout" />
      <main className="shell pt-32 pb-24">
        <div className="max-w-[60ch]">
          <h1 className="display-l">{title}</h1>
          <div className="mt-10 flex flex-col gap-6 text-tone-muted">{children}</div>
          <Link to="/" className="link mt-12 inline-block text-tone-muted">
            Back to LYZN
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  )
}

export function PrivacyPolicy() {
  useDocumentTitle('Privacy — LYZN')

  const answered = [PRIVACY_DELETE, PRIVACY_RETENTION, PRIVACY_ACCESS].filter(Boolean)

  return (
    <Policy title="Privacy">
      <p>
        LYZN records conversations, so this page has to be worth reading. Below is what the product
        does today, described the way it is actually built.
      </p>

      <dl className="flex flex-col gap-6 border-t border-tone-line pt-8">
        {PRIVACY.facts.map((fact) => (
          <div key={fact.label}>
            <dt className="label-sm text-tone-faint">{fact.label}</dt>
            <dd className="mt-2">{fact.body}</dd>
          </div>
        ))}
        {answered.map((line) => (
          <div key={line}>
            <dd>{line}</dd>
          </div>
        ))}
      </dl>

      <p className="border-t border-tone-line pt-8">
        The complete policy, including retention periods and how to have a recording removed, is
        published before the first units ship.
        {CONTACT_EMAIL ? (
          <>
            {' '}
            Until then, questions go to{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="link text-tone">
              {CONTACT_EMAIL}
            </a>
            .
          </>
        ) : null}
      </p>
    </Policy>
  )
}

export function Terms() {
  useDocumentTitle('Terms — LYZN')

  return (
    <Policy title="Terms and refunds">
      <p>
        LYZN is sold as a preorder. You are reserving a unit from the first production run, and the
        pendant ships when that run is complete.
      </p>

      <dl className="flex flex-col gap-6 border-t border-tone-line pt-8">
        <div>
          <dt className="label-sm text-tone-faint">The pendant</dt>
          <dd className="mt-2">
            A physical product, delivered to the address given at checkout. Indian addresses only
            for the first run.
          </dd>
        </div>
        <div>
          <dt className="label-sm text-tone-faint">The software</dt>
          <dd className="mt-2">
            Transcription, summaries and task creation, reached through the LYZN app with the email
            given at checkout.
          </dd>
        </div>
        <div>
          <dt className="label-sm text-tone-faint">Automation</dt>
          <dd className="mt-2">
            Optional, and separate from the price of either plan. It is billed monthly from the day
            it is activated, not from the day the order is placed, and it can be cancelled at any
            time.
          </dd>
        </div>
        {PAYMENT_TERMS && (
          <div>
            <dt className="label-sm text-tone-faint">Payment</dt>
            <dd className="mt-2">{PAYMENT_TERMS}</dd>
          </div>
        )}
      </dl>

      <p className="border-t border-tone-line pt-8">
        The full terms, including the cancellation and refund window, are published before the first
        units ship.
        {CONTACT_EMAIL ? (
          <>
            {' '}
            Until then, questions go to{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="link text-tone">
              {CONTACT_EMAIL}
            </a>
            .
          </>
        ) : null}
      </p>
    </Policy>
  )
}

export function NotFound() {
  return (
    <Policy title="Not found">
      <p>There is nothing at this address.</p>
    </Policy>
  )
}
