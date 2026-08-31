# Hyperlocal

A private map of place notes and reviews, shared with the handful of people you invite.
You tap a café on the map, write "good coffee, bad food", optionally rate it, and only
your friends and family can see it. Notes about the same business gather onto one page,
so a pub accumulates everyone's opinion, and you can filter the map down to one person.

Built on **atproto Spaces**, the permissioned-data alpha.

## Why it isn't just records in your Bluesky account

Ordinary atproto records are public. Anything written with `createRecord` is
world-readable by DID and goes out on the firehose, and there is no per-record ACL to
turn that off. Publishing "bad food" about a named local restaurant, permanently and
indexably, under your real handle, is the wrong default for this — it is the difference
between telling your sister and telling the internet, and about a real trader who did
not ask to be reviewed.

A **space** is an authorization and sync boundary. A space authority (a DID) controls
membership, each member keeps their own permissioned repo on their own PDS, and an app
assembles the view by pulling from each member's host. Space data explicitly does not go
on the firehose, and there is no relay for it. `com.atproto.simplespace`'s
`memberListPolicy` is exactly the model here: one group, you add people by handle.

**Access control, not confidentiality.** This is the limit worth being clear about. The
data is not encrypted. Every member can read everything, and so can the PDS hosting it.
The protection is against the world, not against a member or the host. There is also no
revocation of what someone already read: removing a member stops them getting anything
new, and does nothing about what is already on their laptop. For coffee opinions among
family that is the right trade. For anything that actually matters it is not.

## What Spaces costs

- **Not your real Bluesky handle.** Spaces need a spaces-capable PDS: the hosted sandbox
  (invite at `bsky.network/account`) or self-hosted
  `ghcr.io/bluesky-social/atproto:pds-spaces-alpha`.
- **Genuine alpha.** Breaking changes are expected. The packages are pinned to
  `0.0.0-spaces-alpha-20260818163953` and will rot.
- **No backups**, and Bluesky say plainly: do not upload sensitive information.

`docs/spaces-alpha-notes.md` records how the alpha actually works, since almost none of
it is documented yet.

## What this deliberately does not have

Worth stating, because a public equivalent of this app would need all of it:

- **No firehose consumer.** Space data is not on the firehose, so there is nothing to
  tail, no cursor to persist, no reconnect logic.
- **No allowlist.** The space's member list *is* the access control.
- **No AppView, no server-side index, no bbox API.** At family scale — tens of people,
  hundreds to low thousands of notes — the browser holds the whole space in memory and
  filtering is a pass over an array. A spatial index for 2,000 points is a `filter`.

The only server is `place-proxy`, which caches OpenStreetMap lookups. It exists to be
polite to volunteer-run services, and holds none of your data.

## Businesses come from OpenStreetMap, three ways

Each source does the one thing it is actually good at.

**Picking a business: the map tiles, free.** OpenFreeMap's Liberty style follows the
OpenMapTiles schema, which carries a `poi` layer from z14. `queryRenderedFeatures` turns
a tap into a named business with no network call at all — those tiles are already loaded
to draw the map.

**Identifying it: Overpass, once.** The OpenMapTiles `poi` schema exposes no stable OSM
id, so tiles alone cannot tell that two notes are about the same café. Overpass can, but
public instances budget only a few hundred moderate queries a day. So it is never called
on pan or zoom — only when the compose panel opens on a point, and the answer is cached
by rounded coordinate for a month. If it fails, you get a plain pin and the note still
saves.

**Searching by name: Photon, not Nominatim.** Nominatim's usage policy *strictly
forbids* autocomplete and caps at one request per second. Photon is the OSM geocoder
built for as-you-type.

Map data © OpenStreetMap contributors, ODbL. MapLibre attributes the tiles
automatically; the place names and ids stored in notes come from the same source.

## Running it

```bash
npm install
npm run dev          # vite on 127.0.0.1:5173 + the OSM proxy on 8787
npm test             # 60 unit tests over the pure logic
npm run test:e2e     # 10 Playwright tests, fully offline
npm run check        # typecheck + unit + build + e2e
```

Open `http://127.0.0.1:5173`. **Not `localhost`** — atproto's browser OAuth accepts only
`127.0.0.1` and `[::1]` as loopback origins, and redirects `localhost` to the IP, losing
any session in storage. Vite is configured to bind the address it wants.

Without signing in you get **demo mode**: fixture notes in browser storage, the whole UI
working, no account needed. The businesses in it are invented — seeding a demo with
fabricated opinions about real premises seemed like the wrong thing to put into the
world, even in a fixture.

### Signing in, and inviting people

Sign in with a handle on a spaces-capable PDS. On first run the app creates your space
(`xyz.hyperlocal.space`, one per person, key `self`). Share the link with `?owner=<your
handle>` and add people by handle — you are the space authority, so only you can manage
the member list.

That last point is a real constraint, not a design choice:
`simplespace.listMembers` requires OAuth on the authority's PDS and explicitly refuses a
space credential, so a member hosted elsewhere cannot enumerate the list at all.

### Deploying

```bash
PUBLIC_URL=https://your.site npm run build:deploy   # writes client-metadata.json, builds dist/
fly deploy --config place-proxy/fly.toml --dockerfile place-proxy/Dockerfile
```

The production OAuth `client_id` must be a public HTTPS URL serving the metadata
document, and the scope inside it must match what the app requests exactly. Both come
from one constant in `shared/scope.ts` so they cannot drift.

## Layout

```
lexicons/     the note record, the space type, the permission set
shared/       pure logic: validation, geometry, filtering, grouping, the scope
web/          the app: OAuth, space sync, MapLibre, compose
place-proxy/  Overpass + Photon, rate-limited and cached. No npm dependencies.
```

`shared/` imports nothing — not the DOM, not maplibre, not an alpha package — so the
logic that decides what you see is unit-tested with no browser and no network.
Validation restates the lexicon's limits rather than importing an alpha schema package,
and `test/lexicon-drift.test.ts` reads the JSON and asserts the two agree, so the
duplication cannot rot quietly. The same validator runs on compose and on sync, because
a space grants access, not trust: another member's client can write anything into their
own repo, and it arrives at your machine.

Three runtime dependencies: `maplibre-gl`, `@atproto/oauth-client-browser`,
`@atproto/jwk-jose`. The DPoP proof is implemented directly in `web/dpop.ts` rather than
imported from `@atproto/space`, whose barrel pulls CAR decoding and `node:fs` into a
browser bundle for the sake of twenty lines.

## What has and has not been verified

Run `npm run check` and everything in it passes: 60 unit tests, 10 end-to-end tests, a
clean typecheck and build. The Photon search path has been exercised against the live
service, and the degradation path has been exercised for real, because Overpass was
unreachable while this was written and a note still saved with a plain pin.

**Nothing here has been run against a real space.** The hosted sandbox is invite-gated
and self-hosting needs Docker. Every space call is written from the lexicons on
`bluesky-social/atproto@permissioned-data` and from Bulletin's source, and the OAuth
scope is checked against the real `@atproto/oauth-scopes` parser — but the sync, the
credential exchange and the writes are unproven against a live PDS.

`npm run spike` is what proves them. Point it at a PDS with two accounts and it creates
the space, adds a member, writes a note from each, reads the whole space back through a
minted credential, and then checks the thing that actually matters: that an
unauthenticated client is refused, and that the notes do not appear in the public repo.
Run it before trusting any of this with something you would not say out loud.

## What it deliberately doesn't do

No encryption, so no protection from a member or from the host. No moderation beyond
choosing who you invite. No revocation of what a former member already synced. No
antimeridian-crossing bounding boxes. Businesses are only tappable from z14 up, where
the tiles carry POIs. An OSM id can go stale — a shop remapped from a node to a building
way changes identity, so older notes stop grouping with newer ones, though they keep
their own coordinate and never vanish from the map.
