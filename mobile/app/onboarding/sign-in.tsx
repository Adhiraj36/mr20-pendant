/**
 * A1 — where "I already have an account" goes, and where everyone else goes
 * too. Apple, Google, or six digits in an email.
 *
 * The canvas draws a phone number and an OTP. The Clerk instance has no
 * phone factor configured, so the same shape is served by an **email**
 * address and the same six boxes on the next screen (plan §9.2). Apple and
 * Google stay because a provider brings a verified address, a name and a
 * picture with it, which is why nothing later has to ask for any of them.
 *
 * Clerk decides for itself whether an address is a new account or a
 * returning one — `useEmailCode` tries the sign-in and falls through to a
 * sign-up when Clerk says it has never seen the identifier — so this screen
 * has one form and no "are you new?" question.
 */
import { useEffect, useState } from 'react';
import { View, Platform, KeyboardAvoidingView, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSSO } from '@clerk/clerk-expo';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import {
  Screen, TopRow, TopAction, Txt, Label, Button, Field, Card, useTone,
} from '../../src/design/kit';
import { AppleMark, GoogleMark } from '../../src/design/icons';
import { useEmailCode } from '../../src/onboarding/useEmailCode';
import { SIGN_IN } from '../../src/design/copy';

/**
 * Where the provider sends the browser back to.
 *
 * `karma://` and not this app's own `lyzn://`, because the Clerk instance is
 * the live Lyzn one and that is the redirect its dashboard already allows.
 * A scheme it does not recognise is rejected before the user ever reaches a
 * consent screen. Both schemes are registered by this build, so the link
 * resolves either way — this one also gets past Clerk.
 */
const OAUTH_REDIRECT = Linking.createURL('oauth-native-callback', { scheme: 'karma' });

/**
 * Android opens the auth sheet noticeably faster when the browser is already
 * warm. A no-op on iOS, and cooled down on unmount so nothing is held open.
 */
function useWarmBrowser() {
  useEffect(() => {
    if (Platform.OS === 'ios') return;
    void WebBrowser.warmUpAsync();
    return () => { void WebBrowser.coolDownAsync(); };
  }, []);
}

type Provider = 'google' | 'apple';

export default function SignIn() {
  const router = useRouter();
  const tone = useTone();
  const { startSSOFlow } = useSSO();
  const email = useEmailCode();
  useWarmBrowser();

  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState<Provider | null>(null);
  const [failed, setFailed] = useState(false);

  const continueWith = async (provider: Provider) => {
    if (busy) return;
    setBusy(provider);
    setFailed(false);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: provider === 'google' ? 'oauth_google' : 'oauth_apple',
        redirectUrl: OAUTH_REDIRECT,
      });

      if (!createdSessionId || !setActive) {
        // Almost always the browser being dismissed. Not a failure worth
        // shouting about, so the screen is left exactly as it was.
        return;
      }
      await setActive({ session: createdSessionId });
      // The launch gate re-decides from here: a plan may be owed, or a
      // pendant, or neither.
      router.replace('/');
    } catch (err) {
      const message = readableClerkError(err);
      if (/cancel/i.test(message)) return;
      // The screen says one plain sentence (§7); the coded reason still has
      // to go somewhere, or a failed sign-in is unreportable.
      console.warn('[sign-in] SSO failed:', message);
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  const sendCode = async () => {
    const attempt = await email.send(address);
    if (!attempt) return;
    router.push({
      pathname: '/onboarding/code',
      params: {
        kind: attempt.kind,
        emailAddressId: attempt.emailAddressId ?? '',
        address: attempt.address ?? address.trim(),
      },
    });
  };

  /**
   * The provider marks are SVGs with their own colour prop rather than kit
   * icons, so the ink they sit on is read off the tone here. Apple's is the
   * label's own colour on a filled button; Google's mark is multicoloured
   * and keeps its own.
   */
  const glyph = (which: Provider) =>
    which === 'apple'
      ? () => <AppleMark size={16} color={tone.invFg} />
      : () => <GoogleMark size={16} />;

  const provider = (which: Provider) => (
    <Button
      key={which}
      full
      variant={which === 'apple' ? 'primary' : 'secondary'}
      icon={glyph(which)}
      title={which === 'apple' ? SIGN_IN.apple : SIGN_IN.google}
      busy={busy === which}
      busyLabel="OPENING…"
      disabled={!!busy}
      onPress={() => continueWith(which)}
    />
  );

  return (
    <Screen>
      <TopRow
        back="BACK"
        onBack={() => router.back()}
        right={<TopAction label={SIGN_IN.help} />}
      />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerClassName="px-[26px] pt-[28px] pb-[34px] gap-[18px]"
          keyboardShouldPersistTaps="handled"
        >
          <View>
            <Txt variant="screen">{SIGN_IN.title}</Txt>
            <Txt variant="body" tone="muted" className="mt-[12px]">{SIGN_IN.line}</Txt>
          </View>

          <View className="gap-[10px]">
            {/* Apple first on iOS: it is the platform's own, and App Review
                expects it to be at least as prominent as the alternatives.
                Google first on Android, for the same reason in reverse. */}
            {Platform.OS === 'ios'
              ? [provider('apple'), provider('google')]
              : [provider('google'), provider('apple')]}
            {failed ? <Txt variant="small" tone="danger">{SIGN_IN.failed}</Txt> : null}
          </View>

          <Label variant="eyebrow" center className="mt-[4px]">{SIGN_IN.or}</Label>

          <View className="gap-[10px]">
            <Field
              value={address}
              onChangeText={(next) => { setAddress(next); email.setError(undefined); }}
              placeholder={SIGN_IN.emailPlaceholder}
              keyboardType="email-address"
              // iOS capitalises the first letter of a text field by default,
              // which turns `nikhil@…` into `Nikhil@…` in the box. Clerk
              // happens to fold the case, but the field showing something the
              // person did not type is its own bug — and the local part of an
              // address is not guaranteed to be case-insensitive anywhere else.
              autoCapitalize="none"
              returnKeyType="send"
              onSubmitEditing={() => { if (address.trim()) void sendCode(); }}
              accessibilityLabel="email address"
              invalid={!!email.error}
              message={email.error}
            />
            <Button
              full
              variant="secondary"
              title={SIGN_IN.send}
              busy={email.busy}
              busyLabel="SENDING…"
              disabled={!!busy || address.trim().length === 0}
              onPress={sendCode}
            />
          </View>

          <Card variant="carbon">
            <Label variant="tag">{SIGN_IN.noteEyebrow}</Label>
            <Txt variant="small" tone="muted" className="mt-[7px]">{SIGN_IN.note}</Txt>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/**
 * Clerk reports failures as an array of coded errors; the long message is the
 * useful one, and the generic Error message usually is not. Only ever read by
 * the log line above — the screen's own wording is fixed.
 */
function readableClerkError(err: unknown): string {
  const errors = (err as { errors?: { longMessage?: string; message?: string }[] })?.errors;
  const first = errors?.[0];
  return first?.longMessage ?? first?.message ?? (err as Error)?.message ?? 'Something went wrong.';
}
