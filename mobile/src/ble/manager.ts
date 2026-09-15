/**
 * BLE manager lifecycle, permissions and discovery.
 *
 * One BleManager for the whole app: creating a second one on Android silently
 * breaks scanning in the first.
 */
import { Platform, PermissionsAndroid } from 'react-native';
import { BleManager, Device, State } from 'react-native-ble-plx';
import { ADVERTISED_NAME_PREFIX, SVC_UUID } from './protocol';

let manager: BleManager | null = null;

export function bleManager(): BleManager {
  if (!manager) manager = new BleManager();
  return manager;
}

export interface DiscoveredDevice {
  id: string;
  name: string;
  rssi: number;
  /** True when the device advertised the MR20 service UUID. Ours does not. */
  advertisedService: boolean;
}

/**
 * Ask for whatever this platform needs to scan.
 *
 * Android 12+ split Bluetooth out into its own runtime permissions; before
 * that, scanning counted as location access.
 */
export async function requestPermissions(): Promise<{ granted: boolean; missing: string[] }> {
  if (Platform.OS !== 'android') return { granted: true, missing: [] };

  const api = Number(Platform.Version);
  const needed =
    api >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  const result = await PermissionsAndroid.requestMultiple(needed);
  const missing = needed.filter((p) => result[p] !== PermissionsAndroid.RESULTS.GRANTED);
  return { granted: missing.length === 0, missing };
}

/**
 * Watch the adapter itself, not any one link.
 *
 * Every BLE failure mode looks the same from above — "could not connect" — but
 * the user can fix exactly one of them: Bluetooth being switched off. Surfacing
 * that case separately, and reconnecting the moment the radio comes back,
 * is the difference between an app that explains itself and one that sulks.
 * The initial state is emitted immediately.
 */
export function onAdapterState(handler: (poweredOn: boolean) => void): () => void {
  const subscription = bleManager().onStateChange((state) => {
    if (state === State.PoweredOn) handler(true);
    else if (state === State.PoweredOff || state === State.Unauthorized) handler(false);
    // Unknown/Resetting are transitional; wait for a definitive answer.
  }, true);
  return () => subscription.remove();
}

/** Resolve once the adapter is powered on, or reject if the user leaves it off. */
export async function waitForPoweredOn(timeoutMs = 15000): Promise<void> {
  const bm = bleManager();
  const state = await bm.state();
  if (state === State.PoweredOn) return;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.remove();
      reject(new Error('Bluetooth is not switched on'));
    }, timeoutMs);

    const subscription = bm.onStateChange((next) => {
      if (next === State.PoweredOn) {
        clearTimeout(timer);
        subscription.remove();
        resolve();
      }
    }, true);
  });
}

/**
 * Scan for candidate pendants.
 *
 * Our unit does not advertise its service UUID, so filtering by service finds
 * nothing. Scan unfiltered and match on the advertised name instead, keeping
 * the strongest signal for each device seen.
 */
export function scanForPendants(
  onUpdate: (devices: DiscoveredDevice[]) => void,
  onError: (error: Error) => void,
): () => void {
  const bm = bleManager();
  const seen = new Map<string, DiscoveredDevice>();
  let stopped = false;

  bm.startDeviceScan(null, { allowDuplicates: true }, (error, device) => {
    if (stopped) return;
    if (error) {
      onError(error);
      return;
    }
    if (!device) return;

    const name = device.name ?? device.localName ?? '';
    const services = (device.serviceUUIDs ?? []).map((u) => u.toLowerCase());
    const advertisedService = services.includes(SVC_UUID);

    if (!advertisedService && !name.startsWith(ADVERTISED_NAME_PREFIX)) return;

    const existing = seen.get(device.id);
    // RSSI jitters; keep the best reading so the list does not thrash.
    if (existing && existing.rssi >= (device.rssi ?? -999)) return;

    seen.set(device.id, {
      id: device.id,
      name: name || 'Pendant',
      rssi: device.rssi ?? -999,
      advertisedService,
    });
    onUpdate([...seen.values()].sort((a, b) => b.rssi - a.rssi));
  });

  return () => {
    stopped = true;
    bm.stopDeviceScan();
  };
}

/** Connect, with the MTU bump requested up front on Android. */
export async function connect(deviceId: string): Promise<Device> {
  const bm = bleManager();
  bm.stopDeviceScan();
  return bm.connectToDevice(deviceId, { timeout: 25000, requestMTU: 517 });
}

/**
 * A short scan for one specific pendant, matched by id or advertised name.
 *
 * The fallback when a direct connect fails: the stored peripheral id can go
 * stale — iOS rotates its per-host UUIDs, Android caches evaporate — while the
 * pendant sits right there advertising. The name (YLF20_<mac suffix>) is
 * derived from the hardware MAC, so it identifies the same physical unit even
 * when the platform's id for it has changed.
 */
function findByScan(
  peripheralId: string,
  name: string | undefined,
  timeoutMs: number,
): Promise<Device | null> {
  const bm = bleManager();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (device: Device | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      bm.stopDeviceScan();
      resolve(device);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);

    bm.startDeviceScan(null, null, (error, device) => {
      if (error) return finish(null);
      if (!device) return;
      const advertised = device.name ?? device.localName ?? '';
      if (device.id === peripheralId || (name && advertised === name)) finish(device);
    });
  });
}

/**
 * Reconnect to a previously paired pendant.
 *
 * On iOS the id is a per-host UUID that survives restarts; on Android it is the
 * MAC. Either way the platform can usually connect straight to it — and when it
 * cannot, a brief scan by advertised name finds the unit under whatever id the
 * platform knows it by today. Callers should adopt the returned device's id if
 * it differs from the one they asked for.
 */
export async function reconnect(
  deviceId: string,
  options: { name?: string; scanTimeoutMs?: number } = {},
): Promise<Device | null> {
  const bm = bleManager();
  const [known] = await bm.devices([deviceId]);
  if (known) {
    const connected = await bm.isDeviceConnected(deviceId);
    if (connected) return known;
  }
  try {
    return await connect(deviceId);
  } catch {
    // Fall through to the scan.
  }

  const found = await findByScan(deviceId, options.name, options.scanTimeoutMs ?? 8000);
  if (!found) return null;
  try {
    return await connect(found.id);
  } catch {
    return null;
  }
}

/**
 * Fire `handler` when the link drops for any reason — out of range, powered
 * off, or the OS reclaiming the connection. Returns an unsubscribe function.
 */
export function onDisconnected(
  device: Device,
  handler: (error: Error | null) => void,
): () => void {
  const subscription = device.onDisconnected((error) => handler(error ?? null));
  return () => {
    try { subscription.remove(); } catch { /* already gone */ }
  };
}

export async function disconnect(deviceId: string): Promise<void> {
  try {
    await bleManager().cancelDeviceConnection(deviceId);
  } catch {
    // Already disconnected; nothing to undo.
  }
}
