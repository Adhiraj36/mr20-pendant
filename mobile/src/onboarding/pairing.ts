/**
 * What the onboarding screens say — app spec §2.3 to §2.5.
 *
 * The screens after Welcome read the same handful of facts: one rail of
 * three steps, a scan that reports an RSSI which has to become a four-tick
 * meter, and a paired pendant that reports a firmware string, a battery,
 * its free space and whether it is recording, which become the rows of the
 * pairing receipt. All of it is arithmetic and copy, so it lives here
 * rather than in the route files: no React, no react-native, and the node
 * test runner can exercise it directly (the same discipline as
 * `design/receiptLogic.ts`).
 */
import { joinLabel } from '../design/tokens';
import type { ReceiptRowSpec } from '../design/receiptLogic';

/**
 * The rail across the top of every screen after Welcome (§2.3–2.5). One
 * array, so the three screens cannot drift out of step with each other.
 */
export const ONBOARDING_STEPS = ['Sign in', 'Pair', 'Ready'];

// -- the scan's signal meter (§2.4) ----------------------------------------

/** The bands the spec names, strongest first. */
const RSSI_THRESHOLDS = [-55, -70, -85] as const;

/**
 * How many of the four ticks a reading lights: thresholds −55 / −70 / −85,
 * the same ones the bar glyph used before it became a `TickRow`. Always at
 * least one — a device that answered the scan is on the list, however
 * faintly.
 */
export function signalLevel(rssi: number): number {
  if (rssi > RSSI_THRESHOLDS[0]) return 4;
  if (rssi > RSSI_THRESHOLDS[1]) return 3;
  if (rssi > RSSI_THRESHOLDS[2]) return 2;
  return 1;
}

/**
 * The `TickRow` value that lights exactly `level` of `ticks`.
 *
 * `TickRow` lights tick `i` when `i / ticks <= value`, so a value sitting
 * exactly on a boundary lights the tick above it too. Half a tick in is the
 * only place that reads the same from either side.
 */
export function tickValue(level: number, ticks: number): number {
  return (Math.max(0, Math.min(ticks, level)) - 0.5) / ticks;
}

// -- the scan's status line (§2.4) -----------------------------------------

/** Where the scan has got to. The screen's own state machine. */
export type PairStage = 'permissions' | 'scanning' | 'connecting' | 'failed';

/**
 * The one mono line under the headline, spelling out what the radio is
 * doing (§2.4). `failed` returns nothing: the error takes that slot, and it
 * is `small` in `danger` rather than a mono label, because a failure is a
 * sentence and not a status.
 */
export function pairStatus(
  stage: PairStage,
  found: number,
  needsPermission: boolean,
): string | undefined {
  switch (stage) {
    case 'permissions':
      // Android asks; iOS just takes a moment to power the radio up.
      return needsPermission ? 'ALLOW BLUETOOTH TO CONTINUE' : 'STARTING BLUETOOTH…';
    case 'scanning':
      return found > 0
        ? joinLabel(['SCANNING', `${found} FOUND`, 'TAP YOURS'])
        : 'SCANNING…';
    case 'connecting':
      return 'CONNECTING…';
    case 'failed':
      return undefined;
  }
}

// -- the pairing receipt (§2.5) --------------------------------------------

/** Fixed copy, kept out of the render so it is not retyped (spec §7). */
export const PAIRING_TITLE = 'LYZN · PAIRED';
export const PAIRING_STAMP = 'LINKED';
export const PAIRING_FOOTER = 'RECORDS ON ITS OWN · SYNCS WHEN IN RANGE';

/** A battery you can walk out of the house with — the row's `ok` (§2.5). */
export const BATTERY_OK_PERCENT = 20;

/** Everything the slip draws on, from the store's `paired` and `info`. */
export interface PendantFacts {
  name?: string;
  firmware?: string;
  batteryPercent?: number;
  freeMb?: number;
  recording?: boolean;
}

/** `YLF20_D830 · FW V1.2` — the slot rule: an unknown fragment is dropped. */
export function pairingMeta(facts: PendantFacts): string {
  return joinLabel([facts.name, facts.firmware ? `FW ${facts.firmware}` : undefined]);
}

/**
 * The slip's rows. A fact the pendant did not report gets no row at all
 * rather than a zero or a dash (spec §0.3) — and `recording` is the one
 * where that matters: undefined means the device did not answer, which is
 * not the same as "not yet".
 */
export function pairingRows(facts: PendantFacts): ReceiptRowSpec[] {
  const rows: ReceiptRowSpec[] = [];
  if (facts.batteryPercent !== undefined) {
    rows.push({
      k: 'BATTERY',
      v: `${Math.round(facts.batteryPercent)}%`,
      ok: facts.batteryPercent >= BATTERY_OK_PERCENT,
    });
  }
  if (facts.freeMb !== undefined) {
    rows.push({ k: 'FREE', v: `${(facts.freeMb / 1024).toFixed(1)} GB` });
  }
  if (facts.recording !== undefined) {
    rows.push({ k: 'RECORDING', v: facts.recording ? 'Yes' : 'Not yet' });
  }
  return rows;
}

// -- printing the slip once, and only on arrival (§2.5, M2) ----------------

/**
 * The pairing receipt is the one slip in the app that legitimately prints
 * on a screen's own mount: it is arriving — the pendant has just been
 * linked and the slip is the proof of it — which is exactly what M2 and
 * `Receipt`'s `printing` prop exist for. Ruling R14 governs the other half:
 * a Ready screen re-entered with a pendant that was already paired must
 * render the slip finished, not print it again.
 *
 * So the print is claimed against a token, not against the device. The Pair
 * screen mints one when a connection succeeds and hands it to Ready as a
 * route param; Ready claims it once and the claim is spent. Anything else
 * that lands on Ready — a deep link, a remount with the same params, a
 * screen restored behind the user — has no unclaimed token and gets the
 * finished slip.
 *
 * Keyed on the pairing rather than on the pendant's MAC because the API
 * keeps a re-paired device's original `pairedAt` (backend `/devices`), so
 * the device's own fields cannot tell a second pairing from the first. A
 * session-scoped set is the same device the spec asks the Library to use
 * for its printing rows (§9, "Printing rows": "keep a set of printed ids …
 * so a refetch or re-render never re-prints").
 */
const printedPairings = new Set<string>();

/** A token unique to one successful pairing. Minted by the Pair screen. */
export function pairingToken(): string {
  return Date.now().toString(36);
}

/**
 * Whether this mount is the arrival that gets to print. True at most once
 * per token, and never for a screen that arrived without one.
 */
export function claimPairingPrint(token: string | undefined): boolean {
  if (!token) return false;
  if (printedPairings.has(token)) return false;
  printedPairings.add(token);
  return true;
}

/** Tests only — the set is otherwise as long-lived as the app process. */
export function resetPairingPrints(): void {
  printedPairings.clear();
}
