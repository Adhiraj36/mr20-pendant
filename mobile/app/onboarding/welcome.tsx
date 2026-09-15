/**
 * O1 — one claim, no carousel.
 *
 * The wordmark at the top, the object itself, one sentence that says what the
 * product does, one that says how, and two ways in. Nothing else: no feature
 * list, no paging dots.
 *
 * The pendant stands where a 120 px gap used to be. It is the one screen a
 * person meets before they own anything, so it shows them the thing rather
 * than describing it — and it costs nothing on a device that cannot draw it,
 * because `PendantVisual` paints its poster first and only fades the render
 * over once a frame has actually arrived (§5.6). The empty band this comment
 * used to warn about was a bare canvas with no poster beneath it; there is a
 * poster beneath this one.
 *
 * Both buttons go to the same place. Clerk decides for itself whether an
 * address it is given is a new account or a returning one, so "set up" and
 * "I already have an account" are the same gesture; the second is offered
 * because a returning user needs to see that the app knows they exist.
 */
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, Txt, Label, Button, Enter } from '../../src/design/kit';
import { WELCOME } from '../../src/design/copy';
import { PendantVisual } from '../../src/components/PendantVisual';

export default function Welcome() {
  const router = useRouter();
  const toSignIn = () => router.push('/onboarding/sign-in');

  return (
    <Screen className="px-[26px] pt-[40px] pb-[34px]">
      <View className="flex-1 justify-between">
        <Enter index={0}>
          <Label variant="mark" tone="fg">{WELCOME.mark}</Label>
        </Enter>

        {/* Hero: the pose §5.3 opens on. `flexShrink` rather than a fixed
            height — on a short screen the object gives its room back to the
            claim and the buttons instead of pushing them off the bottom. */}
        <Enter index={1} style={{ flexShrink: 1 }}>
          <PendantVisual state="hero" />
        </Enter>

        {/* `Enter` carries a Reanimated style, so its layout is a `style`
            and its children hold the classes — never both on one element. */}
        <Enter index={2}>
          <Txt variant="claim">{WELCOME.claim}</Txt>
          <Txt variant="body" tone="muted" className="mt-[18px] max-w-[300px]">
            {WELCOME.line}
          </Txt>
        </Enter>

        <Enter index={3}>
          <View className="gap-[14px]">
            <Button full title={WELCOME.primary} onPress={toSignIn} />
            <Button full variant="ghost" title={WELCOME.secondary} onPress={toSignIn} />
          </View>
        </Enter>
      </View>
    </Screen>
  );
}
