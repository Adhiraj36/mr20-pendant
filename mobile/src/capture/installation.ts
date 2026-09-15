/**
 * This installation's own id, standing in for a pendant's MAC address.
 *
 * `POST /recordings` files a recording against the device that made it, and
 * for a phone recording that device is the phone. It is generated once and
 * kept, so every recording from this install lands under one device rather
 * than a new one each time — which is what makes "recorded on your phone"
 * a thing the account can see, and what stops the device list filling with
 * ghosts.
 *
 * Shaped like a MAC because that column has always held one; prefixed so it
 * can never be mistaken for a real pendant.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'lyzn.installation';

let cached: string | undefined;

export async function installationId(): Promise<string> {
  if (cached) return cached;
  const stored = await AsyncStorage.getItem(KEY).catch(() => null);
  if (stored) {
    cached = stored;
    return stored;
  }
  const hex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  const id = `ph:${hex()}:${hex()}:${hex()}:${hex()}:${hex()}`;
  cached = id;
  await AsyncStorage.setItem(KEY, id).catch(() => undefined);
  return id;
}
