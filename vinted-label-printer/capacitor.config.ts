import type { CapacitorConfig } from '@capacitor/cli';

// The Android app bundles the built site (dist/) and serves it from inside the APK:
// no server, no network, nothing to host.
const config: CapacitorConfig = {
  appId: 'com.jscarrott.labelprinter',
  appName: 'Label Printer',
  webDir: 'dist',
  android: {
    // Labels are read from files on the phone, never from the web.
    allowMixedContent: false,
  },
};

export default config;
