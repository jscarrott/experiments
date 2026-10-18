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
    // From Android 15 apps are drawn behind the status and navigation bars. Without
    // this the title and the bottom of the page sit under them.
    adjustMarginsForEdgeToEdge: 'auto',
  },
};

export default config;
