/**
 * The Android permission set, settled after every other plugin has had its say.
 *
 * Three parties write location permissions into this manifest and they do not
 * agree. `android.permissions` in app.json adds what it is given; the
 * react-native-ble-plx plugin adds ACCESS_COARSE_LOCATION and
 * ACCESS_FINE_LOCATION of its own accord, capped at maxSdkVersion 30 when
 * `neverForLocation` is set; and it silently skips adding BLUETOOTH_SCAN at
 * all if something else already declared it — which app.json does, which is
 * why the neverForLocation flag never appeared. Rather than try to order those
 * three, this runs last and states the result outright.
 *
 * What we actually need:
 *
 *   BLUETOOTH_SCAN + neverForLocation — the pendant is found by scanning, and
 *     nothing here derives a position from the result. Without the flag,
 *     Android 12+ makes BLE scanning depend on the location grant, so a user
 *     who declined location for WiFi could no longer pair at all.
 *
 *   ACCESS_FINE_LOCATION, uncapped — not for location. react-native-wifi-reborn
 *     rejects connectToProtectedSSID outright unless it is granted and location
 *     services are on (RNWifiModule.assertLocationPermissionGranted), on every
 *     Android version, so the WiFi fast path needs it. Below Android 12 it is
 *     also what BLE scanning uses. Declining it costs the fast path and nothing
 *     else: the sync engine falls back to BLE.
 *
 *   ACCESS_COARSE_LOCATION — gone. FINE covers every case above.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

const COARSE = 'android.permission.ACCESS_COARSE_LOCATION';
const FINE = 'android.permission.ACCESS_FINE_LOCATION';
const SCAN = 'android.permission.BLUETOOTH_SCAN';

module.exports = function withAndroidPermissions(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    // Both element names are in play: plain uses-permission, and the
    // uses-permission-sdk-23 form the BLE plugin writes.
    for (const element of ['uses-permission', 'uses-permission-sdk-23']) {
      const entries = manifest[element];
      if (!Array.isArray(entries)) continue;

      manifest[element] = entries.filter((entry) => entry.$?.['android:name'] !== COARSE);

      for (const entry of manifest[element]) {
        const name = entry.$?.['android:name'];
        // Uncap it: capped at 30 the WiFi transfer would fail on Android 12+,
        // where the permission would not be in the manifest to grant.
        if (name === FINE) delete entry.$['android:maxSdkVersion'];
        if (name === SCAN) entry.$['android:usesPermissionFlags'] = 'neverForLocation';
      }
    }
    return config;
  });
};
