/* Detached as of round four: the order is the paysheet in sections/Pricing.tsx, and nothing mounts this. Kept whole for the day the full checkout is needed again. */
import { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useClerk, useUser } from '@clerk/clerk-react'
import { CheckoutShell } from '@/components/checkout/Shell'
import { OrderSummary } from '@/components/checkout/Summary'
import { Field, StateSelect, TextControl } from '@/components/checkout/Fields'
import { SignInCard } from '@/components/checkout/SignInCard'
import { CHECKOUT } from '@/data/content'
import { PLANS, validateDetails, isPhone } from '@/data/pricing'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { orderHref, useOrder } from '@/order/OrderContext'
import { useFieldErrors } from './useFieldErrors'

/** Placeholder blocks at field height, shown while Clerk decides who this is. */
function FormSkeleton() {
  return (
    <div aria-hidden="true" className="flex animate-pulse flex-col gap-10">
      <div className="flex flex-col gap-5">
        <div className="h-12 bg-tone-panel" />
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="h-12 bg-tone-panel" />
          <div className="h-12 bg-tone-panel" />
        </div>
      </div>
      <div className="flex flex-col gap-5">
        <div className="h-12 bg-tone-panel" />
        <div className="h-12 bg-tone-panel" />
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="h-12 bg-tone-panel" />
          <div className="h-12 bg-tone-panel" />
        </div>
      </div>
    </div>
  )
}

/**
 * Step two: who you are, and where it goes — if anything goes anywhere.
 *
 * The whole step changes shape with the plan. Software-only is never asked
 * for a street, because asking somebody for a delivery address for a thing
 * that will arrive by email is how a checkout loses people.
 *
 * It also changes shape with sign-in state (Decision 2): the order is tied
 * to an account, so nothing below the eyebrow is fillable until Clerk says
 * who is filling it. Google, Apple and email code are all Clerk's — none of
 * it is reimplemented here.
 */
/** The part of the contact that rides on the Clerk account between orders. */
type SavedBilling = { phone: string; line1: string; line2: string; city: string; state: string; pin: string }

export function Details() {
  useDocumentTitle('Order — LYZN')

  const { config, contact, totals, setContact, goToStep } = useOrder()
  const { isLoaded, isSignedIn, user } = useUser()
  const clerk = useClerk()
  const form = useRef<HTMLFormElement>(null)
  const [editPhone, setEditPhone] = useState(false)
  const { errors, touch, showAll, all } = useFieldErrors(() =>
    validateDetails(contact, config.plan),
  )

  // The name and email Clerk already holds become the order's — copied in
  // once, not retyped, and never overwritten again by a later render.
  const syncedContact = useRef(false)
  useEffect(() => {
    if (!isSignedIn || !user || syncedContact.current) return
    syncedContact.current = true
    // The address from the last order rides on the account (see submit),
    // so a returning buyer finds it filled in. Only the blanks are taken
    // from it: anything typed on this visit wins.
    const saved = (user.unsafeMetadata?.billing ?? {}) as Partial<SavedBilling>
    const fill = (key: keyof SavedBilling) =>
      contact[key] ? contact[key] : (saved[key] ?? '')
    setContact({
      fullName: user.fullName ?? contact.fullName,
      email: user.primaryEmailAddress?.emailAddress ?? contact.email,
      phone: fill('phone'),
      line1: fill('line1'),
      line2: fill('line2'),
      city: fill('city'),
      state: fill('state'),
      pin: fill('pin'),
    })
    // Runs once, the moment sign-in resolves — not on every contact edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, user])

  const plan = PLANS[config.plan]
  if (!plan) return <Navigate to={orderHref('choose')} replace />

  const submit = () => {
    if (!isSignedIn) return

    showAll()

    const first = Object.keys(all)[0]
    if (first) {
      // Send the cursor to the problem rather than announcing it and
      // leaving somebody to hunt for it.
      form.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus()
      return
    }

    setContact({ invoiceName: contact.invoiceName || contact.fullName })
    // Kept on the account so it is never typed twice. `unsafeMetadata` is
    // the one field a signed-in client may write; nothing here is trusted
    // by the backend, which prices and validates on its own.
    const billing: SavedBilling = {
      phone: contact.phone, line1: contact.line1, line2: contact.line2,
      city: contact.city, state: contact.state, pin: contact.pin,
    }
    void user?.update({ unsafeMetadata: { ...(user.unsafeMetadata ?? {}), billing } }).catch(() => {})
    goToStep('pay')
  }

  const field = (key: keyof typeof contact) => ({
    'data-field': key,
    value: String(contact[key] ?? ''),
    onBlur: () => touch(key),
  })

  const openAccount = () => clerk.openUserProfile()

  // Locked only where Clerk actually supplied the value — the seamless
  // case Decision 2 describes. Email-code sign-in can leave Clerk with no
  // name at all; a field locked to an empty string would be unfillable and
  // unfocusable, so that field stays an ordinary editable one instead.
  const lockedFullName = Boolean(user?.fullName)
  const lockedEmail = Boolean(user?.primaryEmailAddress?.emailAddress)

  return (
    <CheckoutShell
      step="details"
      eyebrow={CHECKOUT.details.eyebrow}
      title={plan.physical ? CHECKOUT.details.headline.pendant : CHECKOUT.details.headline.software}
      chargedToday={totals.chargedToday}
      action={{ label: 'Continue to payment', onClick: submit, disabled: !isSignedIn }}
      back={{ label: 'Back', step: 'choose' }}
      summary={<OrderSummary config={config} totals={totals} />}
    >
      {!isLoaded ? (
        <FormSkeleton />
      ) : !isSignedIn ? (
        <div className="flex flex-col gap-6">
          <div>
            <p className="label-sm mb-1 text-tone-faint">{CHECKOUT.details.signIn.eyebrow}</p>
            <p className="text-[15px] text-tone-muted">{CHECKOUT.details.signIn.body}</p>
          </div>
          <SignInCard initialEmail={contact.email} />
        </div>
      ) : (
      <form
        ref={form}
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="flex flex-col gap-10"
      >
        <fieldset className="flex flex-col gap-5 border-0 p-0">
          <legend className="label-sm mb-1 text-tone-faint">Contact</legend>

          <Field
            label="Full name"
            error={errors.fullName}
            dataField="fullName"
            locked={lockedFullName ? { value: contact.fullName, onChange: openAccount } : undefined}
          >
            {(props) => (
              <TextControl
                {...props}
                {...field('fullName')}
                autoComplete="name"
                onChange={(e) => setContact({ fullName: e.target.value })}
              />
            )}
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Email"
              error={errors.email}
              dataField="email"
              locked={lockedEmail ? { value: contact.email, onChange: openAccount } : undefined}
            >
              {(props) => (
                <TextControl
                  {...props}
                  {...field('email')}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  onChange={(e) => setContact({ email: e.target.value })}
                />
              )}
            </Field>

            {/* Already known — typed into the pricing form, or kept on the
                account — it is shown, not asked for again. Change unlocks it. */}
            <Field
              label="Phone"
              error={errors.phone}
              hint="+91"
              locked={
                !editPhone && isPhone(contact.phone)
                  ? { value: `+91 ${contact.phone}`, onChange: () => setEditPhone(true) }
                  : undefined
              }
            >
              {(props) => (
                <TextControl
                  {...props}
                  {...field('phone')}
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  maxLength={10}
                  onChange={(e) => setContact({ phone: e.target.value.replace(/\D/g, '') })}
                />
              )}
            </Field>
          </div>

          {!plan.physical && (
            <p className="text-[15px] text-tone-muted">{CHECKOUT.details.softwareNote}</p>
          )}
        </fieldset>

        {plan.physical && (
          <fieldset className="flex flex-col gap-5 border-0 p-0">
            <legend className="label-sm mb-1 text-tone-faint">Delivery</legend>

            <Field label="Address line 1" error={errors.line1}>
              {(props) => (
                <TextControl
                  {...props}
                  {...field('line1')}
                  autoComplete="address-line1"
                  onChange={(e) => setContact({ line1: e.target.value })}
                />
              )}
            </Field>

            <Field label="Address line 2 (optional)">
              {(props) => (
                <TextControl
                  {...props}
                  {...field('line2')}
                  autoComplete="address-line2"
                  onChange={(e) => setContact({ line2: e.target.value })}
                />
              )}
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="City" error={errors.city}>
                {(props) => (
                  <TextControl
                    {...props}
                    {...field('city')}
                    autoComplete="address-level2"
                    onChange={(e) => setContact({ city: e.target.value })}
                  />
                )}
              </Field>

              <Field label="State" error={errors.state}>
                {(props) => (
                  <StateSelect
                    {...props}
                    {...field('state')}
                    autoComplete="address-level1"
                    onChange={(e) => setContact({ state: e.target.value })}
                  />
                )}
              </Field>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="PIN code" error={errors.pin}>
                {(props) => (
                  <TextControl
                    {...props}
                    {...field('pin')}
                    inputMode="numeric"
                    autoComplete="postal-code"
                    maxLength={6}
                    onChange={(e) => setContact({ pin: e.target.value.replace(/\D/g, '') })}
                  />
                )}
              </Field>

              <Field label="Country">
                {(props) => (
                  <TextControl {...props} value="India" readOnly className="text-tone-muted" />
                )}
              </Field>
            </div>
          </fieldset>
        )}

        {/* Enter submits the form. It is hidden from assistive technology
            and from the tab order because the visible button beside the
            summary carries the same name, and two controls called the same
            thing is worse than none. */}
        <button type="submit" aria-hidden="true" tabIndex={-1} className="sr-only">
          Continue to payment
        </button>
      </form>
      )}
    </CheckoutShell>
  )
}
