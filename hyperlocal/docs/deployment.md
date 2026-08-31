# Deploying Hyperlocal

Three pieces. Only one of them costs money, and only one of them is difficult.

| Piece | Where | Cost | Without it |
|---|---|---|---|
| Web app | GitHub Pages | £0 | Nothing works |
| PDS | An **amd64** VM | ~£5/month | Nobody can sign in; demo mode only |
| OSM place proxy | Fly.io, or a Cloudflare Worker | £0–2/month | Every note gets a plain pin |

Plus the domain you already own. Realistically **~£70/year**, nearly all of it the VM.

Do them in this order. Each stage is useful on its own, and each one is verifiable before
you start the next.

---

## Stage 1 — the app (about ten minutes)

The app deploys itself from `.github/workflows/hyperlocal-pages.yml`. Three settings, one
of which is a repo oddity worth fixing while you are in there.

**1. DNS, at Hover.** Add one record:

```
hyperlocal   CNAME   jscarrott.github.io.
```

The apex `jscarrott.com` already points at GitHub Pages (`185.199.108–111.153`) from a
different repository. A repo gets one Pages site and different repos can serve different
subdomains of the same domain, so this does not disturb your existing site. Nothing is
added to that site's repo either — everything here is a new subdomain.

**2. Settings → Pages → Source: GitHub Actions.**

**3. Settings → Branches → default branch** (tidiness, not a blocker). It is currently
`claude/caddy-maxi-3d-visualizer-77ioxq` — a leftover session branch, sitting on the same
commit as `main`. The workflow names `main` explicitly, so it fires on a push there
whatever the default is; what the default *does* affect is where a PR opened without an
explicit base lands. Worth setting to `main` so future PRs do not quietly target a stale
branch.

Then merge the PR, or go to **Actions → Deploy Hyperlocal → Run workflow** and pick the
branch — `workflow_dispatch` exists so you can publish before merging.

**Check it worked:**

- `https://hyperlocal.jscarrott.com` loads and shows the demo notes on a map.
- `https://hyperlocal.jscarrott.com/client-metadata.json` returns **200**, with
  `client_id` equal to that exact URL. That URL *is* the OAuth client id — a 404 here
  breaks sign-in completely, and it is the single most common way this goes wrong.

At this point the app works in demo mode for anyone who visits. Sign-in does not, because
there is nothing to sign in to yet.

---

## Stage 2 — the PDS (the real work)

This is the only piece that costs money and the only one that can lose data.

### It must be amd64

Verified against the registry: `ghcr.io/bluesky-social/atproto:pds-spaces-alpha`
publishes **an amd64 manifest and nothing else**. There is no arm64 build.

That rules out the Raspberry Pi, Hetzner's ARM (CAX) range, Oracle's free ARM tier and
AWS Graviton. The *official* `bluesky-social/pds` image is multi-arch, so the code clearly
builds for ARM — nobody has built the alpha for it. Building your own arm64 image from the
`permissioned-data` branch is possible but means rebuilding on every alpha change, which
is not a thing to sign up for.

**Get an x86_64 VM.** Hetzner CX22 (~€4.50–6/month; they raised cloud prices in June 2026,
so check current) is ample — 2 vCPU and 4 GB is far more than a family needs.

### DNS

```
pds     A   <your VM's IP>
*.pds   A   <your VM's IP>
```

The wildcard matters: family handles become `mum.pds.jscarrott.com`, and each one needs to
resolve so its TLS certificate can be issued. Confirm Hover supports wildcard A records —
if not, move DNS to Cloudflare (free) and re-point the existing Pages records for the apex
and `www` while you are there.

Open **80 and 443**. The official PDS setup fronts itself with Caddy doing on-demand
issuance over HTTP-01, so port 80 is not optional and you do not need a wildcard
certificate.

### Install

Start from the official self-hosting setup in `bluesky-social/pds` — its installer and
compose file handle Caddy, the data directory and secret generation. Then make one change:
**swap the image for the spaces build, pinned by digest.**

```
ghcr.io/bluesky-social/atproto:pds-spaces-alpha@sha256:813a08fe81630bc2eadcf77c03552f0b22fd7c3a23f746e926ccc7cffc49c876
```

Pin the digest rather than tracking the tag. The alpha is explicitly expected to make
breaking changes, and you want those to arrive when you choose, not when a container
restarts at 3am.

> **Not verified.** Nothing in this repository has been run against a real PDS — this
> container has no Docker daemon and the hosted sandbox is invite-gated. The install steps
> above are read from the official docs and the spaces proposal, not executed. Expect the
> spaces image to want configuration the standard installer does not set; read its startup
> logs rather than assuming a silent failure is normal.

### Accounts

Create one account per family member with `pdsadmin`. Handles come out as
`mum.pds.jscarrott.com`. If you want the nicer `mum.jscarrott.com`, add a
`_atproto.mum.jscarrott.com` TXT record holding `did=did:plc:…` — DNS only, no web change.
`_atproto.jscarrott.com` is unused, so you could also claim `@jscarrott.com` for yourself.

### Backups — do not skip this

The alpha ships with **no backups**, and self-hosted this box holds the only copy of the
family's notes. A nightly `tar` or `restic` of the PDS data directory to object storage is
enough; Hetzner's own backups are +20% on the server cost and also fine. Set it up on day
one, before anyone writes anything they would miss.

---

## Stage 3 — the gate, before anyone is invited

```bash
PDS_URL=https://pds.jscarrott.com \
A_HANDLE=you.pds.jscarrott.com   A_PASSWORD=... \
B_HANDLE=test.pds.jscarrott.com  B_PASSWORD=... \
npm run spike
```

It creates the space, adds the second account as a member, writes a note from each, reads
the whole space back through a minted credential, and then checks the thing that actually
matters: that an unauthenticated client is **refused**, and that the notes do **not**
appear in the public repo listing.

**Do not invite family until this passes.** The entire privacy argument for this app rests
on those last two assertions, and they have never been run against a live PDS.

---

## Stage 4 — the OSM proxy (optional, do it last)

Without it the app skips place lookups entirely and every note gets a plain pin. Everything
else — map, notes, filters, per-business grouping of notes that already have an OSM id —
works exactly as before.

Deploy it:

```bash
fly deploy --config place-proxy/fly.toml --dockerfile place-proxy/Dockerfile
```

Then set the repository variable **`HYPERLOCAL_PLACES_URL`** to its HTTPS URL and re-run
the deploy workflow. It must be **HTTPS**: the app is served over TLS, so a plaintext proxy
URL is mixed content and the browser blocks it.

A Cloudflare Worker is the cheaper alternative — the proxy has no npm dependencies, so it
is mostly swapping `node:http` for a `fetch` handler and `node:sqlite` for the Cache API.
The one thing that does not port cleanly is the serial rate-limit queue, since Workers are
stateless and concurrent; at family scale roughly one person composes at a time and the
cache absorbs the repeats, so a Durable Object is not worth it. Keep the `User-Agent` and
the caching, which are the parts Overpass actually cares about.

---

## Stage 5 — bring the family in

1. Sign in at `hyperlocal.jscarrott.com` with your handle. On first run the app creates
   your space.
2. **Who can see this** → invite each person by handle.
3. **Copy invite link** and send it. The link carries `?owner=<your DID>`, which a guest
   needs — a space is anchored on its owner's DID, and without it they would open their
   own empty space instead.

---

## When the alpha breaks

It will. The pinned digest means it breaks when you decide, not on its own. To move:

1. Bump the digest in the compose file.
2. Re-run `npm run spike` **against a throwaway space** before pointing the family's space
   at the new build.
3. Watch for lexicon or API changes in `com.atproto.space` / `com.atproto.simplespace` —
   `docs/spaces-alpha-notes.md` records what the current API surface looks like, so it is
   the place to diff against.

If a change is not worth chasing, the app keeps working on the pinned image indefinitely.
Nothing here depends on the alpha moving forward.

---

## Cost summary

| | |
|---|---|
| Domain | already owned (~£10/year) |
| App on GitHub Pages | £0 |
| PDS on an amd64 VM | ~£4.50–6/month |
| Backups | £0–1/month |
| OSM proxy | £0 as a Worker, ~£2/month on Fly |
| **Total** | **~£60–90/year** |
