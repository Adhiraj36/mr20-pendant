// The app's stylesheet and the `className` registrations, both imported for
// their side effects and both before anything that renders. `_layout.tsx` is
// the first user module expo-router evaluates, which is the whole reason
// they sit here rather than anywhere else.
import '../global.css';
import '../src/design/interop';

import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SystemUI from 'expo-system-ui';
import { ClerkProvider, useAuth, useUser } from '@clerk/clerk-expo';
import { useApp, ensureConnected, flushUploads } from '../src/state/store';
import type { ClerkPlanMetadata } from '../src/plan/resolve';
import {
  publishableKey, tokenCache, setTokenProvider, setSignOutHandler,
} from '../src/api/auth';
import { registerForPush, useNotificationRouting } from '../src/notifications/push';
import { seedDevSession } from '../src/dev/fixtures';
import { useTheme } from '../src/design/tone';
import { tones } from '../src/design/tokens';
import { ToastProvider } from '../src/design/Toast';
import { hydrateTheme } from '../src/design/tone';
import { colors, fontFamily } from '../src/design/tokens';

/**
 * Every family name in `fonts.native` — which `tokens.ts` re-exports as
 * `fontFamily` — so a weight the package adds cannot reach a style without a
 * file behind it. `satisfies` below is what enforces that: a missing key is
 * a type error, not a fake bold on a device.
 */
type Face =
  | (typeof fontFamily.sans)[keyof typeof fontFamily.sans]
  | (typeof fontFamily.mono)[keyof typeof fontFamily.mono];

/**
 * Archivo 400/500/600/800 and Martian Mono 400/500/600/700 — ruling R17: the
 * app takes the website's faces, so a heading is the same shape in both
 * places. Geist is gone from the app entirely.
 *
 * Eight files, not six. The two heaviest cuts are what the app's type scale
 * gained when it started reading `typeScale` and `button` from @lyzn/design:
 * **Archivo 800** is the three display variants, and **Martian Mono 700** is
 * the button's label. Both need a real file — Android synthesises a fake
 * bold for any weight it has no file for, and a synthesised 800 is not this
 * face (spec §4.2, §9 Fonts). Mono 600 is still the receipt's alone (§3.3
 * gives its header, stamp and total value at 600 three times); sans 600 is
 * loaded because the package names it and the site loads it.
 *
 * Required by path rather than through the package index so Metro bundles
 * eight files instead of each family's thirty-odd.
 */
const FONTS = {
  Archivo_400Regular: require('@expo-google-fonts/archivo/400Regular/Archivo_400Regular.ttf'),
  Archivo_500Medium: require('@expo-google-fonts/archivo/500Medium/Archivo_500Medium.ttf'),
  Archivo_600SemiBold: require('@expo-google-fonts/archivo/600SemiBold/Archivo_600SemiBold.ttf'),
  Archivo_800ExtraBold: require('@expo-google-fonts/archivo/800ExtraBold/Archivo_800ExtraBold.ttf'),
  MartianMono_400Regular: require('@expo-google-fonts/martian-mono/400Regular/MartianMono_400Regular.ttf'),
  MartianMono_500Medium: require('@expo-google-fonts/martian-mono/500Medium/MartianMono_500Medium.ttf'),
  MartianMono_600SemiBold: require('@expo-google-fonts/martian-mono/600SemiBold/MartianMono_600SemiBold.ttf'),
  MartianMono_700Bold: require('@expo-google-fonts/martian-mono/700Bold/MartianMono_700Bold.ttf'),
} satisfies Record<Face, unknown>;

// Held until the fonts are in and Clerk has answered, so nothing paints in a
// fallback face and no gate decides before it knows who is signed in.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** How long to wait for Clerk before assuming nobody is signed in. */
const CLERK_LOAD_TIMEOUT_MS = 8000;

/**
 * The seam between Clerk and everything that is not React.
 *
 * The API client, the sync engine and the voice socket are plain functions with
 * no component around them, so they cannot call `useAuth`. This registers
 * Clerk's `getToken` and `signOut` for them to reach, and pushes Clerk's
 * verdict into the store so the rest of the app can go on asking one question
 * — `signedIn` — without knowing who answers it.
 */
function ClerkBridge({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, getToken, signOut } = useAuth();
  const { user } = useUser();
  const applyAuth = useApp((s) => s.applyAuth);
  const applyClerkPlan = useApp((s) => s.applyClerkPlan);

  useEffect(() => {
    setTokenProvider(() => getToken());
    setSignOutHandler(() => signOut());
    return () => {
      setTokenProvider(null);
      setSignOutHandler(null);
    };
  }, [getToken, signOut]);

  useEffect(() => {
    // Nothing is decided until Clerk has restored whatever session it had.
    // Acting on `isSignedIn` before that treats every cold start as signed
    // out, and the launch gate would send a signed-in user to the welcome
    // screen before the real answer arrived.
    if (!isLoaded) return;
    const email = user?.primaryEmailAddress?.emailAddress;
    // What the account bought, as Clerk already knows it. This is the copy
    // `clerkPlan` is documented to hold: it is in memory the instant a
    // session restores, so the launch gate can tell a paying account from a
    // new one without waiting on `GET /plan` — and nobody who has a plan is
    // shown a price list for the beat before the API answers. Set before
    // `applyAuth`, because signing out is what clears it.
    applyClerkPlan(
      isSignedIn ? (user?.publicMetadata as ClerkPlanMetadata | undefined) : undefined,
    );
    applyAuth(isSignedIn ?? false, email).catch(() => undefined);
  }, [isLoaded, isSignedIn, user, applyAuth, applyClerkPlan]);

  useEffect(() => {
    if (isLoaded) return;
    // Clerk not answering at all would otherwise hold the app on its splash
    // screen indefinitely, since the gate waits for an answer. Treat a long
    // silence as signed out: the worst case is a sign-in screen for somebody
    // who has a session, which resolves itself the moment Clerk catches up.
    const timer = setTimeout(() => {
      applyAuth(false).catch(() => undefined);
    }, CLERK_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isLoaded, applyAuth]);

  return <>{children}</>;
}

export default function RootLayout() {
  const { ground } = useTheme();
  const router = useRouter();
  const bootstrap = useApp((s) => s.bootstrap);
  const signedIn = useApp((s) => s.signedIn);
  const ready = useApp((s) => s.ready);
  const appState = useRef(AppState.currentState);
  const wasSignedIn = useRef(signedIn);

  /**
   * The session ended while the app was open — signed out from Settings,
   * expired, or revoked from another device.
   *
   * The launch gate is the only thing in the app that routes on `signedIn`,
   * and it is not mounted once somebody is inside the tabs, so without this
   * a sign-out changed the store and left the person standing on a screen
   * that is a view of an account they no longer hold. Back to `/` and the
   * gate decides again, which keeps one answer to "where does this person
   * belong" rather than two.
   *
   * Only the true → false edge: signing in is routed by the screen that did
   * it, and the initial false at launch is the gate's own business.
   */
  useEffect(() => {
    const was = wasSignedIn.current;
    wasSignedIn.current = signedIn;
    if (!was || signedIn) return;
    // Everything that was pushed belonged to that session — Settings, a
    // conversation, the receipt it printed. Dropping the stack first is what
    // stops a swipe-back from walking into any of it.
    if (router.canDismiss()) router.dismissAll();
    router.replace('/');
  }, [signedIn, router]);

  // A font that fails to decode is not worth holding the splash for — the
  // system face is ugly, a permanently black screen is worse.
  const [fontsLoaded, fontError] = useFonts(FONTS);
  const fontsSettled = fontsLoaded || !!fontError;

  // `ready` is the store's word for "Clerk has answered" — the bridge sets it
  // through `applyAuth`, and the eight-second timeout guarantees it arrives.
  // Whichever lands last drops the splash.
  useEffect(() => {
    if (fontsSettled && ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsSettled, ready]);

  // A tapped notification opens what it was about, whether the app was running
  // or had to be launched to handle it.
  useNotificationRouting();

  useEffect(() => {
    // Paints the window behind the React tree, so overscroll and the gap
    // under a sheet are the app's own ground rather than the system's — the
    // desk by day, the night by choice.
    SystemUI.setBackgroundColorAsync(tones[ground].bg).catch(() => undefined);
    // The appearance the person chose, re-applied. NativeWind's own
    // `colorScheme` does not survive an OTA reload, so ours is read back off
    // AsyncStorage on every boot — before the splash lifts, not after.
    hydrateTheme().catch(() => undefined);
    bootstrap();
  }, [bootstrap, ground]);

  // Registration waits for a session, because the token is stored against a
  // user: asking before sign-in would prompt a stranger for permission and
  // then have nowhere to file the answer. Re-run on every sign-in, since the
  // OS may reissue a token at any time and the backend put is idempotent.
  //
  // `ask: false` is the important half. The prompt itself belongs to O7,
  // after the first pendant is paired and the app has shown what it will
  // tell you about; here we only mint a token when permission already
  // exists. iOS allows one prompt, and it should be spent on a moment that
  // has earned it.
  useEffect(() => {
    if (!signedIn) return;
    registerForPush({ ask: false }).catch(() => undefined);
  }, [signedIn]);

  // A screenshot pass has no Clerk session, and everything worth looking at
  // is behind one. Development only, and only when fixtures are switched on.
  useEffect(() => { if (__DEV__) void seedDevSession(); }, []);

  // Android tears down BLE links aggressively when the app is backgrounded, so
  // coming back to the foreground is the moment to re-establish it — and to
  // push any recordings a dead network left stranded on the phone.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        ensureConnected();
        flushUploads().catch(() => undefined);
      }
      appState.current = next;
    });
    // And every couple of minutes while the app stays open: uploads whose
    // backoff has expired get another try without any user action.
    const flusher = setInterval(() => { flushUploads().catch(() => undefined); }, 2 * 60_000);
    return () => {
      subscription.remove();
      clearInterval(flusher);
    };
  }, []);

  return (
    // ClerkProvider is outermost: the bridge below it needs Clerk's hooks, and
    // the token cache is what keeps a session across cold starts — without it
    // Clerk's default in-memory cache signs everyone out on every launch.
    <ClerkProvider publishableKey={publishableKey()} tokenCache={tokenCache}>
      <ClerkBridge>
        <GestureHandlerRootView style={{ flex: 1, backgroundColor: tones[ground].bg }}>
          <SafeAreaProvider>
            <ToastProvider>
              {/* No StatusBar here: `Screen` is the only writer, so the two
                  cannot disagree about a ground (spec §1.3). */}
              <Stack
                screenOptions={{
                  // No navigation headers anywhere (spec §1.3): every pushed
                  // screen draws its own `TopRow` inside the safe area. The
                  // last native header belonged to `chat/[id]` and went with
                  // that screen's rebuild, so the header styling that used to
                  // sit here has nothing left to style.
                  headerShown: false,
                  contentStyle: { backgroundColor: tones[ground].bg },
                  animation: 'slide_from_right',
                }}
              >
                {/* Every route the app has. The stack's own background is
                    the theme's ground rather than ink: a screen paints its
                    own through `Screen`, but the navigator's canvas shows
                    for a frame during a push. */}
                <Stack.Screen name="index" />
                <Stack.Screen name="onboarding" />
                <Stack.Screen name="oauth-native-callback" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="recording/[id]" />
                <Stack.Screen name="recording/[id]/ask" options={{ presentation: 'transparentModal', animation: 'fade' }} />
                <Stack.Screen name="task/[id]" />
                <Stack.Screen name="task/[id]/edit" />
                <Stack.Screen name="receipt/[id]" />
                <Stack.Screen name="settings/index" />
                <Stack.Screen name="settings/categories" />
                <Stack.Screen name="settings/daemon" />
              </Stack>
            </ToastProvider>
          </SafeAreaProvider>
        </GestureHandlerRootView>
      </ClerkBridge>
    </ClerkProvider>
  );
}
