/**
 * A pendant, for a simulator that has no Bluetooth radio.
 *
 * The numbers are canvas P1's: `YLF20`, 36 %, 1.4 of 8 GB, firmware 1.2.0,
 * recording since 11:04, all synced at 09:38. The battery trail is seeded
 * with two readings four hours apart, which is what makes `≈5H LEFT`
 * *derive* rather than be typed — the screenshot then proves the estimator,
 * not a string constant.
 *
 * Development only; `loadFixtures()` is the only caller and it is behind
 * `__DEV__` and a switch.
 */
import { useApp } from '../../state/store';
import type { PendantView } from '../../pendant/model';

/** Canvas P1's device. */
const MAC = 'F0:13:D8:30:AA:01';

/** Which of the three states a screenshot wants. Seeded, or a route param. */
export const PENDANT_FIXTURE_KEY = 'lyzn.fixtures.pendant';

/**
 * `36 %`, four hours after `52 %` — 4 %/h, so 36 % has nine hours in it.
 * The canvas says five, which is a different (and equally invented) rate;
 * what matters is that the number on screen came out of the estimator.
 */
function trail(): { at: number; percent: number }[] {
  const now = Date.now();
  return [
    { at: now - 5 * 3_600_000, percent: 71 },
    { at: now - 2 * 3_600_000, percent: 50 },
    { at: now, percent: 36 },
  ];
}

export async function seedDeviceFixtures(): Promise<void> {
  const now = new Date();
  const syncedAt = new Date(now.getTime() - 23 * 60_000).toISOString();

  useApp.setState({
    paired: {
      mac: MAC,
      peripheralId: 'FIXTURE-PERIPHERAL',
      name: 'YLF20_D830',
      firmware: '1.2.0',
      batteryPercent: 36,
      freeMb: 6758,
      totalMb: 8192,
      lastSeenAt: now.toISOString(),
      pairedAt: new Date(now.getTime() - 3 * 86_400_000).toISOString(),
    },
    info: {
      firmware: '1.2.0',
      wifiFirmware: '1.0.4',
      mac: MAC,
      batteryPercent: 36,
      // 1.4 GB used of 8 — the canvas' storage bar exactly.
      freeMb: 6758,
      totalMb: 8192,
      recording: true,
      deviceTime: now.toISOString(),
      recordMode: 'VAD',
    },
    link: 'connected',
    btOn: true,
    recordIntent: 'on',
    batteryTrail: trail(),
    lastSyncAt: syncedAt,
    onboarded: true,
  });
}

/**
 * The state a screenshot asked for, if it asked.
 *
 * `?fixture=away` on the route, or `lyzn.fixtures.pendant` in storage. The
 * screen consults this only under `__DEV__` with fixtures on; in every other
 * build it is `undefined` and the real device decides.
 */
export function parsePendantFixture(value: unknown): PendantView | undefined {
  if (value === 'connected' || value === 'away' || value === 'full' || value === 'none') {
    return value;
  }
  return undefined;
}
