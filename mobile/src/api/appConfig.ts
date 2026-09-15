/**
 * The remote configuration, fetched and kept — plan §2.4's `GET /config`.
 *
 * Three properties the app needs from it, in the order they matter:
 *
 * 1. **It works offline.** The prices and the feature flags decide what the
 *    chooser and the settings screen even contain, so a launch on a dead
 *    network must not render an empty app. The last good document is kept in
 *    AsyncStorage and returned before the network is consulted at all.
 * 2. **It is cheap to re-ask.** The endpoint sends an `ETag` and is behind a
 *    60-second CloudFront behaviour; the stored tag goes back as
 *    `If-None-Match`, and a `304` costs a round trip and no parsing.
 * 3. **It never throws.** `coerceAppConfig` makes a document out of whatever
 *    arrives, and every failure path here ends at the cache or at the
 *    built-in defaults.
 *
 * The endpoint is **public** — it is what a signed-out welcome screen prices
 * itself from — so this deliberately does not go through `api/client.ts`,
 * which attaches a bearer token and bounces on a 401.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { config as backend } from './config';
import { coerceAppConfig, DEFAULT_APP_CONFIG, type AppConfig } from '../plan/config';

export type {
  AppConfig, AppFeatures, AppTier, AppPricing, AppPricingCopy,
} from '../plan/config';
export { DEFAULT_APP_CONFIG, tiersOnSale, tierById, formatINR } from '../plan/config';

/** Where the document and its tag are kept. */
export const CONFIG_STORAGE_KEY = 'lyzn.config';
export const CONFIG_ETAG_STORAGE_KEY = 'lyzn.config.etag';

/** Long enough for a slow network, short enough not to hold a launch. */
const TIMEOUT_MS = 8000;

/** What a read produced, and where it came from. */
export interface ConfigResult {
  config: AppConfig;
  source: 'network' | 'cache' | 'default';
}

/** The last document that arrived, or nothing. Never throws. */
export async function cachedAppConfig(): Promise<AppConfig | undefined> {
  try {
    const raw = await AsyncStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return undefined;
    return coerceAppConfig(JSON.parse(raw));
  } catch {
    // A half-written value, or a JSON parse against a truncated string.
    return undefined;
  }
}

/** Replace the cached document and its tag together, or neither. */
async function store(config: AppConfig, etag: string | null): Promise<void> {
  try {
    await AsyncStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
    if (etag) await AsyncStorage.setItem(CONFIG_ETAG_STORAGE_KEY, etag);
    else await AsyncStorage.removeItem(CONFIG_ETAG_STORAGE_KEY);
  } catch {
    // A full disk costs the offline copy, not the running app.
  }
}

/** Forget it. Called on sign-out, so a shared phone starts from the truth. */
export async function clearAppConfig(): Promise<void> {
  await AsyncStorage.multiRemove([CONFIG_STORAGE_KEY, CONFIG_ETAG_STORAGE_KEY]).catch(
    () => undefined,
  );
}

/**
 * Fetch it, falling back to the cache and then to the defaults.
 *
 * A `304` is a success: the tag we sent is still current, so the cached
 * document is the current document. Anything else that is not a `200` — a
 * 500, a captive portal returning HTML, a timeout — is treated the same way
 * as being offline, because from the app's side it is.
 */
export async function fetchAppConfig(): Promise<ConfigResult> {
  const cached = await cachedAppConfig();
  const etag = await AsyncStorage.getItem(CONFIG_ETAG_STORAGE_KEY).catch(() => null);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${backend.apiUrl}/config`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(cached && etag ? { 'If-None-Match': etag } : {}),
      },
      signal: controller.signal,
    });

    if (response.status === 304 && cached) return { config: cached, source: 'cache' };
    if (!response.ok) throw new Error(`config: HTTP ${response.status}`);

    const config = coerceAppConfig(await response.json());
    await store(config, response.headers.get('etag'));
    return { config, source: 'network' };
  } catch {
    if (cached) return { config: cached, source: 'cache' };
    return { config: DEFAULT_APP_CONFIG, source: 'default' };
  } finally {
    clearTimeout(timer);
  }
}
