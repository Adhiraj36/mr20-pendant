/**
 * U1 → checkout → U2. Choose a tier, pay the deposit, keep the receipt.
 *
 * Everything on the left of the price comes out of `GET /config` — the tier
 * names, their lines, their badges, the chooser's own heading and the
 * India-only note. Nothing is typed here, which is the point: a price
 * changes without a release, and a tier can be switched off between a person
 * opening the app and tapping RESERVE (the backend refuses a disabled tier
 * rather than pricing it at nothing).
 *
 * The app never sends an amount. `POST /orders` prices the tier server-side
 * from the same document, and the `checkout` block that comes back is handed
 * to Razorpay verbatim. On success `POST /orders/:ref/verify` checks the
 * signature, writes the `PLAN` row and pushes the tier into Clerk — which is
 * why `user.reload()` runs immediately afterwards, so the app's own copy of
 * `publicMetadata` is the one the backend just wrote.
 *
 * It is a chooser, not a toll gate. Reached from the launch gate there is
 * nothing underneath it, so it draws CLOSE ✕ rather than a BACK arrow that
 * has nowhere to go — and closing it says so (`skipChooser`), which is what
 * stops the gate putting it back the next time. An account with no plan is
 * still an account: it signs in, it records, and it meets this screen again
 * at the surfaces that actually need a plan.
 *
 * Store policy: the pendant is a physical good (Apple 3.1.3(e), Play's
 * physical-goods exemption), so Razorpay is the correct — and required —
 * payment method. Act Pro's ₹499 a month is software consumed in the app; it
 * is **disclosed** on its card and started only on the website. Nothing here
 * takes a mandate.
 */
import { useMemo, useState } from 'react';
import { View, Platform, KeyboardAvoidingView, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useUser } from '@clerk/clerk-expo';
import {
  Screen, TopRow, TopAction, Txt, Label, Button, Card, Field, Receipt,
  Touchable, useTone, useToast,
} from '../../src/design/kit';
import { useApp } from '../../src/state/store';
import { useGoBack } from '../../src/nav/back';
import { tiersOnSale, formatINR, type AppTier } from '../../src/plan/config';
import {
  createOrder, verifyOrder, isMobile, mobileDigits, mobileState, cleanMobile,
  type CreatedOrder,
} from '../../src/plan/orders';
import { payWithRazorpay } from '../../src/plan/razorpay';
import { printQuietly } from '../../src/receipts/print';
import { PLAN_COPY } from '../../src/design/copy';

/** `09:41:58` — a receipt states the moment, not the day. */
function clock(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export default function PlanScreen() {
  const router = useRouter();
  const tone = useTone();
  const toast = useToast();
  const { user } = useUser();
  const appConfig = useApp((s) => s.appConfig);
  const loadPlan = useApp((s) => s.loadPlan);
  const skipChooser = useApp((s) => s.skipChooser);
  const email = useApp((s) => s.email);
  const { canGoBack, goBack } = useGoBack('/');

  /**
   * Out of here without buying. The flag goes down first so the gate — which
   * is where `/` lands — reads the new answer and carries on to the app
   * rather than turning this screen straight back round.
   */
  const close = () => {
    void skipChooser();
    goBack();
  };

  const tiers = useMemo(() => tiersOnSale(appConfig), [appConfig]);
  const copy = appConfig.pricing.copy;

  const [chosen, setChosen] = useState<string>(() => tiers[1]?.id ?? tiers[0]?.id ?? '');
  const [phone, setPhone] = useState('');
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  /** Set once a payment is verified. Its presence is what makes this U2. */
  const [paid, setPaid] = useState<{ order: CreatedOrder; at: string; tier: AppTier }>();

  const tier = tiers.find((t) => t.id === chosen);
  const phoneNow = mobileState(phone);
  /**
   * Red goes under a number that cannot become right — a bad first digit, an
   * eleventh one — the moment it is typed. A number that is only half typed
   * is called wrong once the box has been left, and not before.
   */
  const phoneBad = phoneNow === 'invalid' || (phoneTouched && phoneNow === 'partial');
  /** The tier is chosen for you; the number is the only thing RESERVE waits on. */
  const ready = !!tier && phoneNow === 'ok';

  const reserve = async () => {
    if (!tier || busy) return;
    setPhoneTouched(true);
    setNotice(undefined);
    if (!isMobile(phone)) {
      setNotice(PLAN_COPY.badPhone);
      return;
    }
    const address = email ?? user?.primaryEmailAddress?.emailAddress;
    if (!address) {
      setNotice('We need an email on the account before an order can be placed.');
      return;
    }

    setBusy(true);
    try {
      const order = await createOrder({
        plan: tier.id,
        contact: {
          fullName: user?.fullName ?? undefined,
          email: address,
          phone: mobileDigits(phone),
        },
      });

      const outcome = await payWithRazorpay(order.checkout, { themeColor: tone.stamp });
      if (!outcome.ok) {
        if (outcome.reason === 'cancelled') setNotice(PLAN_COPY.cancelled);
        else setNotice(outcome.message ?? PLAN_COPY.failed);
        return;
      }

      await verifyOrder(order.reference, outcome.payment);

      // The backend has just written the tier into Clerk's public metadata;
      // this is what pulls it into this process, so the gate and every
      // `features` check see it without waiting for a session refresh.
      await user?.reload().catch(() => undefined);
      await loadPlan().catch(() => undefined);

      const at = clock();
      // Printed server-side so it lands in the receipts roll — a proof that
      // only ever existed on this screen would be a proof you could not find
      // again. Fire and forget: a receipt that failed to print is not a
      // payment that failed.
      void printQuietly({
        kind: 'plan',
        title: `${tier.name} reserved.`,
        rows: [
          { k: 'PAID', v: formatINR(tier.deposit) },
          { k: 'PLAN', v: tier.name.toUpperCase() },
          { k: 'FULL PRICE', v: formatINR(tier.full) },
          { k: 'RECURRING', v: tier.monthly > 0 ? `${formatINR(tier.monthly)}/MO` : 'NONE' },
          { k: 'ORDER', v: order.reference },
        ],
      });

      setPaid({ order, at, tier });
    } catch (err) {
      setNotice((err as Error).message || PLAN_COPY.failed);
      toast.show('That did not work', { detail: (err as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  if (paid) {
    return (
      <Screen>
        <View className="flex-1 px-[26px] pt-[44px]">
          <Label variant="back" tone="settled">{PLAN_COPY.paidAt(paid.at)}</Label>
          <Txt variant="screen" className="mt-[12px]">{PLAN_COPY.paidTitle}</Txt>

          <Receipt
            className="mt-[20px]"
            title={appConfig.pricing.copy.receiptTitle}
            stamp="UNLOCKED"
            quote={`${paid.tier.name} reserved.`}
            quoted={false}
            rows={[
              { k: 'PAID', v: formatINR(paid.tier.deposit) },
              { k: 'PLAN', v: paid.tier.name.toUpperCase() },
              { k: 'FULL PRICE', v: formatINR(paid.tier.full) },
              {
                k: 'RECURRING',
                v: paid.tier.monthly > 0 ? `${formatINR(paid.tier.monthly)}/MO` : 'NONE',
              },
              { k: 'ORDER', v: paid.order.reference },
            ]}
            footer={copy.depositNote.toUpperCase()}
            barcodeSeed={paid.order.reference}
          />

          <Txt variant="body" tone="muted" className="mt-[22px]">
            {PLAN_COPY.receiptLine}
          </Txt>
        </View>
        <View className="px-[26px] pb-[34px]">
          <Button full title={PLAN_COPY.continue} onPress={() => router.replace('/')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopRow
        back={canGoBack ? 'BACK' : undefined}
        onBack={canGoBack ? close : undefined}
        right={
          <>
            <TopAction label={copy.indiaOnly ? 'INDIA ONLY' : ''} />
            {canGoBack ? null : (
              <TopAction label={PLAN_COPY.close} tone="muted" onPress={close} />
            )}
          </>
        }
      />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerClassName="px-[22px] pb-[16px] gap-[14px]"
          keyboardShouldPersistTaps="handled"
        >
          <View>
            <Txt variant="screen">{copy.chooserTitle}</Txt>
            <Txt variant="body" tone="muted" className="mt-[10px]">{copy.chooserSub}</Txt>
          </View>

          <View className="gap-[9px]">
            {tiers.map((option) => (
              <TierCard
                key={option.id}
                tier={option}
                selected={option.id === chosen}
                onPress={() => setChosen(option.id)}
              />
            ))}
          </View>

          <Label variant="value" tone="faint">{copy.indiaOnly}</Label>

          <View className="gap-[7px]">
            <Label variant="eyebrow">{PLAN_COPY.phoneLabel}</Label>
            <Field
              value={phone}
              onChangeText={(next) => { setPhone(cleanMobile(next)); setNotice(undefined); }}
              onBlur={() => setPhoneTouched(true)}
              placeholder={PLAN_COPY.phonePlaceholder}
              keyboardType="phone-pad"
              maxLength={14}
              accessibilityLabel="mobile number"
              invalid={phoneBad}
              message={
                phoneBad ? PLAN_COPY.badPhone
                  : phoneNow === 'ok' ? undefined
                    : PLAN_COPY.phoneNeeded
              }
            />
          </View>

          {notice ? <Txt variant="small" tone="danger">{notice}</Txt> : null}
        </ScrollView>

        <View className="px-[22px] pb-[30px] pt-[10px] gap-[8px]">
          {tier ? (
            <View className="flex-row items-baseline gap-[9px]">
              <Txt variant="screen">{formatINR(tier.deposit)}</Txt>
              <Label variant="value" tone="faint">
                {[PLAN_COPY.today, `${formatINR(tier.full)} ${PLAN_COPY.full}`]}
              </Label>
            </View>
          ) : null}
          <Label variant="value" tone="faint">{copy.depositNote}</Label>
          <Button
            full
            title={PLAN_COPY.reserve}
            busy={busy}
            busyLabel={PLAN_COPY.paying}
            disabled={!ready}
            onPress={reserve}
            className="mt-[6px]"
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/**
 * One tier. Selected is the stamp rule the canvas puts round a chosen card
 * (T1's selected task); the rest are paper. The badge, the lines and the
 * monthly disclosure are all the configuration's.
 */
function TierCard({
  tier, selected, onPress,
}: {
  tier: AppTier;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Touchable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={tier.name.toLowerCase()}
      className={
        selected
          ? 'bg-tone-panel border-[1.5px] border-tone-stamp py-[14px] px-[15px]'
          : 'bg-tone-panel border border-tone-line py-[14px] px-[15px]'
      }
    >
      <View className="flex-row items-baseline justify-between gap-[10px]">
        <Txt variant="card">{tier.name}</Txt>
        <Label variant="value" tone={selected ? 'stamp' : 'faint'}>
          {formatINR(tier.deposit)}
        </Label>
      </View>
      {tier.badge ? (
        <Label variant="chip" tone="stamp" className="mt-[5px]">{tier.badge}</Label>
      ) : null}
      <View className="mt-[7px] gap-[2px]">
        {tier.lines.map((line) => (
          <Txt key={line} variant="quote" tone="muted">{`· ${line}`}</Txt>
        ))}
      </View>
      {tier.monthly > 0 ? (
        <Label variant="value" tone="faint" className="mt-[8px]" numberOfLines={2}>
          {PLAN_COPY.monthlyNote(formatINR(tier.monthly))}
        </Label>
      ) : null}
    </Touchable>
  );
}
