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
  plugins: {
    // Android 15+ draws apps behind the status and navigation bars. The page does not
    // ask to go edge to edge (no viewport-fit=cover), so this pads the app clear of
    // them rather than leaving the title and the buttons underneath.
    SystemBars: {
      insetsHandling: 'native',
    },
  },
};

export default config;
