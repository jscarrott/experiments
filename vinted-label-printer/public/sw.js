/**
 * The service worker does two jobs.
 *
 * 1. Receive shared files. Installed on Android, the app appears in the share sheet
 *    for PDFs and images (see share_target in the manifest). Sharing POSTs the files
 *    here; they are parked in a cache and the app is opened with ?shared, where it
 *    picks them up. The files never leave the phone.
 *
 * 2. Work offline. Every same-origin GET is served from the network when there is one
 *    and from the cache when there is not, so the app opens with no signal once it
 *    has been opened once. Network first, so an update to the site shows up on the
 *    next load rather than the one after.
 */

const APP_CACHE = 'label-printer-app-v1';
const SHARE_CACHE = 'label-printer-shared';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== APP_CACHE && key !== SHARE_CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(receiveShare(event.request));
    return;
  }
  if (event.request.method !== 'GET') return;
  event.respondWith(networkFirst(event.request));
});

async function receiveShare(request) {
  const data = await request.formData();
  const cache = await caches.open(SHARE_CACHE);
  let n = 0;
  for (const file of data.getAll('labels')) {
    if (!(file instanceof File)) continue;
    await cache.put(
      new Request(`./__shared/${Date.now()}-${n++}`),
      new Response(file, {
        headers: {
          'content-type': file.type || 'application/octet-stream',
          'x-file-name': encodeURIComponent(file.name || 'shared-label'),
        },
      }),
    );
  }
  return Response.redirect(new URL('./?shared', self.registration.scope).href, 303);
}

async function networkFirst(request) {
  const cache = await caches.open(APP_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (cached) return cached;
    throw error;
  }
}
