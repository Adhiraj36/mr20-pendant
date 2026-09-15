/**
 * Clerk session tokens, and the bridge that hands them to the API client.
 *
 * Clerk owns the sign-in flow and the refresh cycle — `useSSO` drives the
 * screen, and `getToken()` returns a live session token, minting a fresh one
 * whenever the old one is close to expiring. None of that is reimplemented
 * here. What this file exists for is the seam: the API client is plain
 * functions with no React around them, so it cannot call a hook.
 *
 * The provider below is registered once from inside the tree, where Clerk's
 * hooks are available, and read from outside it by every request. Before it is
 * registered — the first frames of a cold start — `currentToken()` returns
 * null, which callers already treat as "not signed in yet".
 */
import * as SecureStore from 'expo-secure-store';

export class AuthError extends Error {}

/** Returns a live session token, or null when nobody is signed in. */
type TokenProvider = () => Promise<string | null>;

let provider: TokenProvider | null = null;

/**
 * Called once from the React tree. Passing null on sign-out stops requests
 * carrying a token that is no longer anyone's.
 */
export function setTokenProvider(next: TokenProvider | null): void {
  provider = next;
}

/** Ends the Clerk session. Registered from the tree, for the same reason. */
type SignOutHandler = () => Promise<void>;

let signOutHandler: SignOutHandler | null = null;

export function setSignOutHandler(next: SignOutHandler | null): void {
  signOutHandler = next;
}

/** Sign out through Clerk, from code that has no hooks available. */
export async function requestSignOut(): Promise<void> {
  await signOutHandler?.().catch(() => undefined);
}

export async function currentToken(): Promise<string | null> {
  if (!provider) return null;
  try {
    return await provider();
  } catch {
    // A refresh that could not reach Clerk. The caller sees this as signed
    // out, which is recoverable, rather than as a crash.
    return null;
  }
}

/** Kept for the call sites that predate Clerk; the name is the only difference. */
export const currentIdToken = currentToken;

/**
 * Where Clerk keeps the session between launches.
 *
 * Its default cache is in-memory, which signs the user out on every cold
 * start. SecureStore is the Keychain on iOS and EncryptedSharedPreferences on
 * Android — the right place for something that is, in effect, a credential.
 */
export const tokenCache = {
  async getToken(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      // A corrupt or unreadable entry must read as "no session", not throw
      // during startup where nothing is watching.
      return null;
    }
  },
  async saveToken(key: string, value: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      // Losing the cache costs a sign-in, not correctness.
    }
  },
  async clearToken(key: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // Already gone.
    }
  },
};

/** The publishable key. Public by design: it ships inside every build. */
export function publishableKey(): string {
  const fromEnv = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (fromEnv) return fromEnv;
  /* eslint-disable @typescript-eslint/no-var-requires */
  const Constants = require('expo-constants').default as {
    expoConfig?: { extra?: { clerkPublishableKey?: string } };
  };
  /* eslint-enable */
  // app.json carries it too, so a build made without a local .env still works.
  const fromConfig = Constants.expoConfig?.extra?.clerkPublishableKey;
  if (fromConfig) return fromConfig;
  throw new AuthError('no Clerk publishable key in this build');
}
