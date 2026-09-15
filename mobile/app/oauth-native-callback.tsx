/**
 * Where an OAuth sign-in lands on its way back into the app.
 *
 * The provider redirects to a URL rather than returning to the code that
 * started the flow, and on Android that deep link needs a route to catch it or
 * expo-router reports it as not found. Clerk has already completed the
 * exchange by the time this mounts; nothing here does any work beyond waiting
 * for the session to settle and sending the user on.
 *
 * It shows what the gate shows — the mark, pulsing (spec §2.1) — so coming
 * back from the browser lands on the same screen the app opened with rather
 * than a platform spinner.
 *
 * The scheme is `karma://` deliberately — see the redirect in sign-in.tsx.
 */
import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/clerk-expo';
import { Screen } from '../src/design/tone';
import { MarkPulse } from '../src/design/MarkPulse';

export default function OAuthNativeCallback() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    if (!isLoaded) return;
    // Signed in goes on to pairing; anything else falls back to the sign-in
    // screen rather than stranding the user on a spinner.
    router.replace(isSignedIn ? '/onboarding/pair' : '/onboarding/sign-in');
  }, [isLoaded, isSignedIn, router]);

  return (
    <Screen ground="ink">
      <View style={styles.host}>
        <MarkPulse />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
