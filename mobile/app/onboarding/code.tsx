/**
 * O2 — six boxes, a caret in stamp violet, a countdown and a way back.
 *
 * The canvas says WhatsApp. There is no WhatsApp channel and no webhook
 * behind one, so every word here says **email** instead (`[WHATSAPP]`, plan
 * §0) — including the note under the boxes, which on the canvas explains why
 * approvals arrive on WhatsApp and here explains what the address is for.
 *
 * The attempt itself lives on Clerk's own client, which is a singleton, so
 * this screen picks it back up with the three facts A1 hands it as params.
 * That is what makes the address and the six digits two screens rather than
 * one long form.
 */
import { useState } from 'react';
import { View, Platform, KeyboardAvoidingView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Screen, TopRow, Txt, Label, Button, CodeBoxes, Card, Touchable,
} from '../../src/design/kit';
import { useEmailCode } from '../../src/onboarding/useEmailCode';
import { CODE } from '../../src/design/copy';

export default function CodeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    kind?: string;
    emailAddressId?: string;
    address?: string;
  }>();

  const [resume] = useState(() => ({
    kind: params.kind === 'signUp' ? ('signUp' as const) : ('signIn' as const),
    emailAddressId: params.emailAddressId || undefined,
    address: params.address || undefined,
  }));
  const email = useEmailCode(resume);

  const verify = async () => {
    if (await email.verify()) {
      // The gate re-decides: a plan may be owed, or a pendant, or neither.
      router.replace('/');
    }
  };

  const wrongAddress = () => {
    email.restart();
    router.back();
  };

  return (
    <Screen>
      <TopRow back="BACK" onBack={() => router.back()} />
      <KeyboardAvoidingView
        className="flex-1 px-[26px]"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View className="flex-1 pt-[24px] gap-[18px]">
          <View>
            <Txt variant="screen">{CODE.title}</Txt>
            {resume.address ? (
              <Txt variant="body" tone="muted" className="mt-[12px]">
                {CODE.sentTo(resume.address)}
              </Txt>
            ) : null}
          </View>

          <CodeBoxes
            value={email.code}
            onChangeText={(next) => { email.setCode(next); email.setError(undefined); }}
            invalid={!!email.error}
          />

          <View className="flex-row justify-between items-center">
            {/* The countdown is a label until it runs out, then it is a link.
                Two elements would have to be kept in step; one that changes
                what it is cannot drift. */}
            <Touchable
              onPress={email.resend}
              disabled={email.wait > 0 || email.busy}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="resend the code"
            >
              <Label variant="ghost" tone={email.wait > 0 ? 'faint' : 'stamp'}>
                {CODE.resendIn(email.wait)}
              </Label>
            </Touchable>
            <Touchable
              onPress={wrongAddress}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="wrong email"
            >
              <Label variant="ghost">{CODE.wrongEmail}</Label>
            </Touchable>
          </View>

          {email.error ? <Txt variant="small" tone="danger">{email.error}</Txt> : null}

          <Card>
            <Label variant="tag">WHY AN EMAIL</Label>
            <Txt variant="small" tone="muted" className="mt-[7px]">
              That address is your account. It is how your conversations follow you to a
              new phone, and the only thing we can reach you on.
            </Txt>
          </Card>
        </View>

        <View className="pb-[34px]">
          <Button
            full
            title={CODE.verify}
            busy={email.busy}
            busyLabel="CHECKING…"
            disabled={email.code.length !== 6}
            onPress={verify}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
