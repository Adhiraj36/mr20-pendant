/**
 * Push notifications: the channels, the category, the permission, the tap.
 *
 * Three things changed in round seven. The backend now sends five events
 * across **three Android channels** (`tasks`, `conversations`, `account`) and
 * one iOS **category** (`task`, with `Mark done` and `Open`) — and Android
 * drops, silently and with no error, any notification naming a channel the
 * app never created, so the channels are created before a token is ever
 * minted. The routing table moved to `routes.ts`, where it can be tested.
 * And the permission is no longer asked for at sign-in: it is asked after
 * the first pairing, on O7, when the app has something concrete to say it
 * will tell you about.
 *
 * Nothing here is allowed to break the app. A denied permission, a simulator
 * with no push capability, a network that is down: each means no
 * notifications, and none of them means a failed launch.
 */
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { api } from '../api/client';
import { useTasks } from '../state/tasks';
import { routeFor } from './routes';

/**
 * Show notifications that arrive while the app is open.
 *
 * The default is to stay silent in the foreground, which is right for a chat
 * app and wrong here: a conversation finishing is worth surfacing whether or
 * not the app happens to be in front of you.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * The three channels the backend names, plus `default` — which is what
 * `app.json`'s `expo-notifications` plugin declares and what anything sent
 * before this release used.
 *
 * `tasks` is the only one at high importance: it is the channel for "you
 * said you would do three things", which is the one message the product
 * exists to deliver. The other two are ordinary.
 *
 * After a channel exists, only its name and description can be changed —
 * every other field needs a **new id** — so these are written once and the
 * ids are not to be reused for something else.
 */
const CHANNELS: {
  id: string;
  name: string;
  importance: Notifications.AndroidImportance;
}[] = [
  { id: 'tasks', name: 'Commitments', importance: Notifications.AndroidImportance.HIGH },
  { id: 'conversations', name: 'Conversations', importance: Notifications.AndroidImportance.DEFAULT },
  { id: 'account', name: 'Account', importance: Notifications.AndroidImportance.DEFAULT },
  { id: 'default', name: 'Conversations', importance: Notifications.AndroidImportance.DEFAULT },
];

/** The notification light, which is the design's own retired green. */
const LIGHT_COLOR = '#EDEAE4';

/** The iOS category the backend stamps on `tasks.proposed`. */
export const TASK_CATEGORY = 'task';

/** Action ids, read back in `useNotificationRouting`. */
export const TASK_ACTION_DONE = 'task.done';
export const TASK_ACTION_OPEN = 'task.open';

/**
 * Android shows nothing at all without a channel, and shows nothing
 * silently: no error, no notification. Must run before a token is minted —
 * on Android 13+ the runtime `POST_NOTIFICATIONS` prompt is what the first
 * channel triggers.
 */
async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Promise.all(
    CHANNELS.map((channel) =>
      Notifications.setNotificationChannelAsync(channel.id, {
        name: channel.name,
        importance: channel.importance,
        lightColor: LIGHT_COLOR,
        showBadge: true,
      }).catch(() => undefined),
    ),
  );
}

/**
 * The action buttons on a commitments notification. `Mark done` runs without
 * opening the app — the whole point of it being on the notification — and
 * `Open` brings the list up.
 */
async function ensureCategories(): Promise<void> {
  await Notifications.setNotificationCategoryAsync(TASK_CATEGORY, [
    {
      identifier: TASK_ACTION_DONE,
      buttonTitle: 'Mark done',
      options: { opensAppToForeground: false },
    },
    {
      identifier: TASK_ACTION_OPEN,
      buttonTitle: 'Open',
      options: { opensAppToForeground: true },
    },
  ]).catch(() => undefined);
}

/** The EAS project this build belongs to; Expo needs it to mint a token. */
function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
}

/** Whether the OS has already been asked, and what it said. */
export async function notificationsGranted(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync().catch(() => undefined);
  return existing?.status === 'granted';
}

/**
 * Ask, mint a token, and hand it to the backend.
 *
 * Called from **O7**, after the first pendant is paired — not at launch and
 * not at sign-in. A prompt that arrives before the app has done anything is
 * a prompt that gets refused, and iOS allows exactly one.
 *
 * Returns the token so the caller can forget it on sign-out, or undefined
 * whenever notifications are simply not going to happen — which is not an
 * error.
 */
export async function registerForPush(
  options: { ask?: boolean } = {},
): Promise<string | undefined> {
  const { ask = true } = options;
  try {
    await ensureChannels();
    await ensureCategories();

    // Never ask twice. Asking again after a refusal achieves nothing on
    // either platform, and on iOS spends the single prompt the system allows.
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      if (!ask) return undefined;
      if (!existing.canAskAgain) return undefined;
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return undefined;

    const id = projectId();
    if (!id) {
      console.warn('[push] no EAS project id in this build; skipping registration');
      return undefined;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    if (!token) return undefined;

    await api.registerPushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
    return token;
  } catch (err) {
    // A simulator without push, a declined prompt, an offline launch. The app
    // works without notifications; say why once and carry on.
    console.warn('[push] not registered:', (err as Error)?.message ?? err);
    return undefined;
  }
}

export async function forgetPush(token: string): Promise<void> {
  await api.forgetPushToken(token).catch(() => undefined);
}

/**
 * Clear the icon badge. Called when Home takes focus: the badge counts what
 * is waiting to be seen, and Home is where it is seen.
 */
export async function clearBadge(): Promise<void> {
  await Notifications.setBadgeCountAsync(0).catch(() => undefined);
}

/**
 * Open what the notification was about.
 *
 * Two paths, and the cold one is easy to miss: a tap that launched the app
 * from scratch has already happened by the time this mounts, so it has to be
 * asked for rather than waited on.
 *
 * `Mark done` does not navigate — it is declared
 * `opensAppToForeground: false`, so there is nowhere to navigate *to* — but
 * it does have to do the thing it says. It runs the same `markDone` the
 * cards run, through the same store, so a receipt is written and the task is
 * already settled the next time the app is opened. A button on a
 * notification that quietly did nothing would be the worst kind of dead
 * control: nobody would ever see it fail.
 */
export function useNotificationRouting(): void {
  const router = useRouter();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    const go = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      // The launch response is returned every time it is asked for, so the
      // same tap must not navigate twice.
      if (handled.current === response.notification.request.identifier) return;
      handled.current = response.notification.request.identifier;

      const bag = response.notification.request.content.data as { taskId?: unknown };
      if (response.actionIdentifier === TASK_ACTION_DONE) {
        const taskId = typeof bag?.taskId === 'string' ? bag.taskId.trim() : '';
        if (taskId) {
          // `ensureTask` first: the store may hold nothing at all on a cold
          // launch into the background, and `markDone` moves a row it has.
          void useTasks.getState().ensureTask(taskId)
            .then(() => useTasks.getState().markDone(taskId))
            .catch(() => undefined);
        }
        return;
      }

      const to = routeFor(response.notification.request.content.data);
      // `as never` because the table names routes other tasks own — the
      // typed-routes union does not include them until those files land.
      if (to) router.push(to as never);
    };

    // Tapped while the app was closed.
    Notifications.getLastNotificationResponseAsync().then(go).catch(() => undefined);
    // Tapped while it was running.
    const subscription = Notifications.addNotificationResponseReceivedListener(go);
    return () => subscription.remove();
  }, [router]);
}
