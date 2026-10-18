/**
 * The installable-app side: registering the service worker, and collecting files
 * shared to the app from Android's share sheet (parked by the service worker).
 */

const SHARE_CACHE = 'label-printer-shared';

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  // Relative, so it works wherever the site is hosted.
  navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('No offline support:', error));
}

/** Files shared to the app, if it was opened by a share. Each is handed over once. */
export async function takeSharedFiles(): Promise<File[]> {
  const params = new URLSearchParams(location.search);
  if (!params.has('shared') || !('caches' in window)) return [];
  // Drop ?shared so a reload does not look for the files again.
  history.replaceState(null, '', location.pathname);

  const cache = await caches.open(SHARE_CACHE);
  const files: File[] = [];
  for (const request of await cache.keys()) {
    const response = await cache.match(request);
    await cache.delete(request);
    if (!response) continue;
    const name = decodeURIComponent(response.headers.get('x-file-name') ?? 'shared-label');
    const type = response.headers.get('content-type') ?? '';
    files.push(new File([await response.blob()], name, { type }));
  }
  return files;
}

/** Whether this device can hand a file to another app (Android, iOS, some desktops). */
export function canShareFiles(): boolean {
  try {
    const probe = new File([new Uint8Array(1)], 'labels.pdf', { type: 'application/pdf' });
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}
