/**
 * Canned API answers, for looking at screens.
 *
 * A screenshot pass on the simulator has no pendant, no Clerk session and no
 * backend, and every screen in this app is a view over one of the three. So
 * a fixture set stands in for the API: `request()` asks here first, and when
 * fixtures are on, a resolver may answer instead of the network. Nothing
 * else in the app knows they exist.
 *
 * Three rules:
 *
 * 1. **Development only.** Every call site is inside `if (__DEV__)`, so the
 *    branch is dead code in a production build. Turning fixtures on in a
 *    release build is not a thing that can happen.
 * 2. **`undefined` means "not mine".** A resolver that does not recognise a
 *    route returns `undefined` and the real request goes out, so a fixture
 *    set can cover Home without pretending to cover the pendant.
 * 3. **One delimited block per task.** Registration blocks are marked with
 *    the task that owns them so three branches can add to this file without
 *    fighting over the import list.
 *
 * ## Turning them on
 *
 * `lyzn.fixtures` in AsyncStorage, read once at first request. On a
 * simulator that is a line in the app container's storage manifest and a
 * relaunch:
 *
 * ```bash
 * app=$(xcrun simctl get_app_container booted com.lyzn.flutter data)
 * printf '{"lyzn.fixtures":"on"}' > "$app/RCTAsyncLocalStorage_V1/manifest.json"
 * xcrun simctl terminate booted com.lyzn.flutter
 * xcrun simctl launch    booted com.lyzn.flutter
 * ```
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ChatToolEvent } from '../../api/client';

export const FIXTURES_STORAGE_KEY = 'lyzn.fixtures';

/**
 * Answers a request, or declines it.
 *
 * `path` arrives exactly as the client wrote it, query string included —
 * `/recordings/rec-quote-ravi`, `/memory/search?q=ravi&limit=8`.
 */
export type FixtureResolver = (
  method: string,
  path: string,
  body?: unknown,
) => unknown | undefined;

const resolvers: FixtureResolver[] = [];

/** Register a set. Called once per block below, at module load. */
export function registerFixtures(resolver: FixtureResolver): void {
  resolvers.push(resolver);
}

// -- the switch ------------------------------------------------------------

let enabled = false;

/**
 * Read once, awaited by the first request and by nothing afterwards. A
 * failure to read storage is "off", which is the safe answer.
 */
const hydrated: Promise<void> = AsyncStorage.getItem(FIXTURES_STORAGE_KEY)
  .then((raw) => {
    console.log('[fixtures] raw =', JSON.stringify(raw));
    enabled = raw === 'on' || raw === 'true' || raw === '1';
  })
  .catch((e) => { console.log('[fixtures] read failed', e); enabled = false; });

/** Whether fixtures are answering. Only meaningful after `hydrated`. */
export function fixturesOn(): boolean {
  return enabled;
}

/** Turn them on or off for the rest of this launch, and remember the choice. */
export async function setFixtures(on: boolean): Promise<void> {
  enabled = on;
  await AsyncStorage.setItem(FIXTURES_STORAGE_KEY, on ? 'on' : 'off').catch(() => undefined);
}

// -- the two hooks the client calls ----------------------------------------

/**
 * The canned answer for a request, or `undefined` to let it go out.
 *
 * A resolver that throws is treated as no answer: a broken fixture must not
 * be able to break the screen it was written to show.
 */
export async function fixtureResponse(
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown | undefined> {
  await hydrated;
  if (!enabled) return undefined;
  for (const resolve of resolvers) {
    try {
      const answer = resolve(method, path, body);
      if (answer !== undefined) return answer;
    } catch {
      // Not this one.
    }
  }
  return undefined;
}

/** What a fixture chat turn streams: text, and the tools it claims to run. */
export interface FixtureTurn {
  text: string;
  tools?: ChatToolEvent[];
}

export type ChatResolver = (
  conversationId: string,
  message: string,
) => FixtureTurn | undefined;

const chatResolvers: ChatResolver[] = [];

export function registerChatFixtures(resolver: ChatResolver): void {
  chatResolvers.push(resolver);
}

/** Roughly how fast a real reply arrives, so the thinking row is visible. */
const TOOL_DELAY_MS = 420;
const WORD_DELAY_MS = 28;

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * Stream a canned reply, word by word, with its tool events first.
 *
 * Returns `true` when it answered, so the caller knows not to open a socket.
 * The pacing is not decoration: the `THINKING · READING n CONVERSATIONS` row
 * only exists while a turn is in flight, and a reply that arrives instantly
 * cannot be photographed.
 */
export async function fixtureChatTurn(
  conversationId: string,
  message: string,
  handlers: { onDelta: (text: string) => void; onTool?: (event: ChatToolEvent) => void },
): Promise<boolean> {
  await hydrated;
  if (!enabled) return false;

  let turn: FixtureTurn | undefined;
  for (const resolve of chatResolvers) {
    try {
      turn = resolve(conversationId, message);
    } catch {
      turn = undefined;
    }
    if (turn) break;
  }
  if (!turn) return false;

  for (const tool of turn.tools ?? []) {
    handlers.onTool?.({ ...tool, status: 'start' });
    await sleep(TOOL_DELAY_MS);
    handlers.onTool?.(tool);
  }

  // Split keeping the spaces, so the reply reads as it is written rather than
  // as a list of words that were joined back together.
  for (const chunk of turn.text.split(/(\s+)/)) {
    if (!chunk) continue;
    handlers.onDelta(chunk);
    await sleep(WORD_DELAY_MS);
  }
  return true;
}

// -- the sets --------------------------------------------------------------

/* >>> T7 — home, conversations, ask lyzn */
import { recordingFixtures, askFixtures } from './recordings';

registerFixtures(recordingFixtures);
registerChatFixtures(askFixtures);
/* <<< T7 */

/* >>> the account — device, plan, config, tasks, receipts, categories */
import { accountFixtures } from './account';

registerFixtures(accountFixtures);
/* <<< account */

// -- the session a screenshot pass needs -----------------------------------

/**
 * Stand in for a signed-in account, so the tabs can be looked at.
 *
 * Everything below the launch gate is behind a Clerk session, and a
 * simulator has none: the gate would send every screenshot pass to the
 * welcome screen. This puts the store where a signed-in launch would put
 * it — and nothing else. It is called from `app/_layout.tsx` under
 * `__DEV__` with fixtures on, and there is no other caller.
 */
export async function seedDevSession(): Promise<void> {
  await hydrated;
  console.log('[fixtures] seedDevSession, enabled =', enabled);
  if (!enabled) return;
  const { useApp } = await import('../../state/store');
  useApp.setState({
    ready: true,
    signedIn: true,
    email: 'nikhil@ghmev.in',
    profile: { name: 'Nikhil' },
    planChecked: true,
    onboarded: true,
  });
  // The pendant too: it is half the app, and a simulator has no radio.
  const { seedDeviceFixtures } = await import('./device');
  await seedDeviceFixtures();
}
