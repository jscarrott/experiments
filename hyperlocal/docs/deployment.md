# Deploying Hyperlocal

Three pieces. Only one of them costs money, and only one of them is difficult.

| Piece | Where | Cost | Without it |
|---|---|---|---|
| Web app | GitHub Pages | £0 | Nothing works |
| PDS | Your desktop over Tailscale, or an **amd64** VM | £0, or ~£5/month | Nobody can sign in; demo mode only |
| OSM place proxy | Fly.io, or a Cloudflare Worker | £0–2/month | Every note gets a plain pin |

Plus the domain you already own. **£0 to start** if the PDS runs on your desktop over
Tailscale; ~£70/year once it moves to a VM, nearly all of which is the VM.

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

The only piece that can lose data, and the only one that might cost money. Two ways to run
it: **Option A** on a desktop you already own, over Tailscale, for £0 — the cheaper way to
start and the way to find out whether any of this works. **Option B** on a VM, when you
want it up whether or not the desktop is.

Either way, read the two constraints first: they apply to both.

### It must be amd64

Verified against the registry: `ghcr.io/bluesky-social/atproto:pds-spaces-alpha`
publishes **an amd64 manifest and nothing else**. There is no arm64 build.

That rules out the Raspberry Pi, Hetzner's ARM (CAX) range, Oracle's free ARM tier and
AWS Graviton. The *official* `bluesky-social/pds` image is multi-arch, so the code clearly
builds for ARM — nobody has built the alpha for it. Building your own arm64 image from the
`permissioned-data` branch is possible but means rebuilding on every alpha change, which
is not a thing to sign up for.

An ordinary Intel or AMD desktop is amd64, so it runs the image natively — this constraint
bites small ARM boards and cloud ARM instances, not desktops.

### Never let it auto-update

The official compose file ships a **watchtower** service that pulls new images at midnight.
On alpha software pinned by digest that is precisely the wrong behaviour — it would replace
a working PDS with a breaking change while you sleep. **Delete the watchtower service.**
The whole point of pinning is that upgrades happen when you decide.

---

## Stage 2, Option A — your desktop, over Tailscale (start here)

Free, and it needs **no changes to the app**. Tailscale gives the PDS a stable hostname
with a genuine TLS certificate, which is all the app ever needed: `resolvePds()` finds the
endpoint through `plc.directory`, handles resolve through DNS, and OAuth gets the HTTPS
authorization server it requires.

### Two hostnames, doing different jobs

This is the bit that makes it work, and the bit that is easy to get wrong.

- **The PDS lives at `<machine>.<tailnet>.ts.net`** — stable, free, and Tailscale issues
  the certificate.
- **Handles come from `jscarrott.com`** — `mum.jscarrott.com`, not
  `mum.<machine>.ts.net`.

They have to be separated because **`ts.net` has no wildcard certificates and no wildcard
DNS**. A PDS issues handles as subdomains of its own hostname by default, so left alone
every family handle would be unreachable. Setting `PDS_SERVICE_HANDLE_DOMAINS` moves them
to a domain you control, where handle resolution is a DNS TXT record rather than something
the PDS has to serve — so no wildcard certificate is needed anywhere.

### Let Tailscale terminate TLS

Run the PDS on loopback with **no Caddy**, and put Tailscale in front:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:3000
```

Two services both trying to obtain a certificate for the same name is the standard way to
lose an afternoon. Tailscale wins because it is the one that can.

**Three gates, and only the last one says so plainly.** Clear them in this order:

1. **Certificate access needs root.** Run as an ordinary user, `tailscale serve` hangs
   with no output at all and writes no config — the least helpful failure of the three.
   `tailscale cert <name>` is the command that admits why: `Access denied: cert access
   denied`. Grant it once with `sudo tailscale set --operator=$USER`.
2. **HTTPS certificates must be enabled for the tailnet**, at **admin console → DNS →
   HTTPS Certificates**. Until they are, `tailscale cert` returns `500 Internal Server
   Error: your Tailscale account does not support getting TLS certs`. `tailscale status
   --json` reports `CertDomains: null` while it is off — but it reports that for
   unprovisioned certs too, so it confirms success rather than diagnosing failure.
3. **Serve must be enabled for the tailnet**, separately from certificates. With the
   operator set, `tailscale serve` stops hanging and prints the one error worth having —
   `Serve is not enabled on your tailnet`, with a `login.tailscale.com/f/serve?node=…`
   link that enables it for that specific node.

Gates 2 and 3 are both admin-console toggles on the tailnet, so whoever owns the tailnet
has to clear them; they are not something the machine can do for itself.

**Serve, not Funnel.** Serve keeps the PDS reachable only from your tailnet, so family
install Tailscale and get invited to it. That is one extra install in exchange for the PDS
never being exposed to the internet at all — a good trade for alpha software holding your
family's notes, and a second lock on top of the space's member list. If that install is a
dealbreaker, `tailscale funnel` gives the same hostname and certificate but publicly
reachable; it is limited to ports 443/8443/10000 and has to be enabled in the tailnet ACL.

### Compose

Start from the official `bluesky-social/pds` setup, then cut it down: **no caddy, no
watchtower**, and bind to loopback rather than host networking.

```yaml
services:
  pds:
    container_name: pds
    image: ghcr.io/bluesky-social/atproto:pds-spaces-alpha@sha256:813a08fe81630bc2eadcf77c03552f0b22fd7c3a23f746e926ccc7cffc49c876
    restart: unless-stopped
    # Loopback only: Tailscale is the only thing that should be able to reach it.
    ports:
      - "127.0.0.1:3000:3000"
    # Not optional on a tailnet — see "Three ways the tailnet bites the PDS" below.
    dns:
      - 100.100.100.100
    volumes:
      - type: bind
        source: /pds
        target: /pds
    env_file:
      - /pds/pds.env
```

The values in `pds.env` that differ from the official sample:

```
PDS_HOSTNAME=<machine>.<tailnet>.ts.net
PDS_SERVICE_HANDLE_DOMAINS=.jscarrott.com
PDS_DPOP_SECRET=<64 hex characters>
PDS_CRAWLERS=
```

`PDS_HOSTNAME` must be right **before you create a single account** — it is written into
every DID document and cannot be changed casually afterwards. Everything else (the JWT
secret, admin password, PLC rotation key, the `PDS_BSKY_*` and `PDS_REPORT_*` defaults)
comes from the official `sample.env`; generate the secrets with its installer rather than
by hand.

`PDS_DPOP_SECRET` must be **exactly 64 characters** — `openssl rand --hex 32`, not
`--hex 16`. Too short and the container exits at startup inside `new DpopManager`, on a
zod `String must contain exactly 64 character(s)` whose only clue to which variable is at
fault is `"path": ["dpopSecret"]`.

`PDS_CRAWLERS` is deliberately **empty**, where the sample points it at
`https://bsky.network` to request relay crawling. Under Serve the PDS is unreachable from
the public internet, so a crawler could not follow the request anyway — and announcing a
private family server to the public relay is the wrong default for this.

**The data directory does not have to be `/pds`.** Only the path *inside* the container is
fixed by `PDS_DATA_DIRECTORY`; the bind source is arbitrary, so `/home/<you>/pds` works and
needs no `sudo` at any point. It is also the better choice on a single-user desktop: the
image runs as its `node` user, which is uid 1000, so on a machine whose first user is also
uid 1000 the data files come out owned by you and stay readable for backup without `sudo`.

### Three ways the tailnet bites the PDS

Tailscale is the cheapest way to get a real hostname and a real certificate, and the price
is paid here. All three of these look like bugs in the alpha and are not; each one cost an
afternoon.

**1. The container has no DNS.** On a machine where Tailscale runs the resolver, the host's
`/etc/resolv.conf` lists only `100.100.100.100` (and its IPv6 twin). Docker will not carry
a CGNAT nameserver into a bridge network, so it silently hands the container an embedded
resolver with no upstream at all:

```
$ docker exec pds cat /etc/resolv.conf
nameserver 127.0.0.11
# Based on host file: '/etc/resolv.conf' (internal resolver)
# NO EXTERNAL NAMESERVERS DEFINED
```

The PDS starts, serves, and authenticates perfectly — and then cannot resolve
`plc.directory`, so every DID resolution hangs until an internal three-second abort. What
surfaces is `401 BadJwt: Invalid delegation token: This operation was aborted` on
`getSpaceCredential`, which reads like a signature problem and is a DNS problem. The
three-second `responseTime` in the PDS log is the tell.

Naming the resolver explicitly in the compose file fixes it, and `100.100.100.100` is the
right one to name rather than a public resolver: it answers for MagicDNS *and* forwards
public queries, and the PDS needs both — public DNS for `plc.directory` and handle
verification, MagicDNS for its own `ts.net` hostname.

```bash
# Confirm before and after:
docker exec pds wget -qO- https://plc.directory/did:plc:…
```

**2. SSRF protection rejects the whole tailnet.** The PDS refuses to fetch a hostname that
resolves outside the public unicast ranges, and every tailnet address is in `100.64.0.0/10`
— CGNAT space, which the check treats as non-routable. It fails with `Hostname resolved to
non-unicast address`. There is no allowlist, only the blunt switch:

```
PDS_DISABLE_SSRF_PROTECTION=true
```

That turns the protection off *entirely*, so the PDS will follow a request to any address
it can reach, including the rest of your tailnet and your LAN. On a single-user desktop
whose PDS is only reachable over Serve that is a defensible trade, but it is a real one —
make it deliberately, and reverse it the moment the PDS moves to a public hostname (Option
B), where it is neither needed nor wise.

**3. TLS is three gates deep**, as above. Two of them are tailnet-wide admin console
toggles, not machine-local settings.

None of this applies to Option B. A VM with a public hostname resolves DNS normally, sits
in public unicast space, and gets its certificate from Caddy — which is the honest argument
for moving to one eventually, beyond uptime.

### Accounts, and why the order matters

You cannot write the `_atproto` TXT record until the DID exists, and the DID does not exist
until the account does. So:

1. `pdsadmin account create` — the handle must end in one of `PDS_SERVICE_HANDLE_DOMAINS`,
   so create it as `mum.jscarrott.com` directly. No DNS is needed yet: a handle under a
   service domain is issued by the PDS itself rather than proved.
2. Note the DID it prints.
3. At Hover, add `_atproto.mum.jscarrott.com` TXT → `did=did:plc:…`, so that everyone
   *else* can resolve the handle to that DID.

Doing it in the other order just fails, confusingly.

**There is no intermediate handle under `PDS_HOSTNAME`.** Setting
`PDS_SERVICE_HANDLE_DOMAINS=.jscarrott.com` replaces the default rather than adding to it —
`describeServer` then reports `availableUserDomains: [".jscarrott.com"]` and nothing else,
so asking for a handle under the `ts.net` name is rejected. Creating the account under its
final name and adding DNS afterwards is the whole procedure.

### The four things to be honest about

1. **The desktop must be awake.** Asleep, nobody can read their notes — including you,
   since your own repo lives on it. Turn off sleep, or accept the outage.
2. **It is the only copy.** The alpha has no backups. Copy the data directory to another
   disk nightly, starting before anyone writes anything they would miss. `pds.env` is the
   part that cannot be regenerated: it holds the PLC rotation key, which is what proves
   ownership of every DID the server issued. Lose the SQLite and you lose the notes; lose
   the rotation key and you lose the ability to move the accounts anywhere, ever.
3. **The hostname is baked into every DID.** Moving to `pds.jscarrott.com` later means a
   signed PLC update per account with the rotation key from `pds.env`, or recreating the
   accounts. `ts.net` names are stable and free, so staying there permanently is a
   perfectly reasonable choice, not a compromise.
4. **Family need Tailscale** under Serve. If that is a problem, use Funnel and accept the
   public exposure.

> **Verified end to end**, on `john-desktop`, 3 September 2026: TLS through Serve, account
> creation, handle resolution through DNS, lexicon publication, OAuth sign-in from the app,
> and a space opened through a minted credential. `npm run spike` is still outstanding — it
> needs a second account.
>
> **Verified.** The pinned digest `813a08fe…` is still what the `pds-spaces-alpha` tag
> resolves to, and it publishes an amd64 manifest and nothing else. The image is the
> spaces build: all 20 `com.atproto.space` lexicons and the 9 `com.atproto.simplespace`
> handlers ship in it, and `com.atproto.space.listSpaces` answers `401 AuthMissing` rather
> than a `404`, so the routes are registered. There is **no env var to enable spaces** —
> nothing in `config/env.js` matches `space` — so the feature is simply on. The compose
> file above starts cleanly (`{"version":"0.5.29"}` on `/xrpc/_health`),
> `PDS_SERVICE_HANDLE_DOMAINS` takes effect as `availableUserDomains`, and the admin
> password authenticates against `com.atproto.server.createInviteCode`.
>
> **Read the logs.** Every failure past the first was silent or misdirected on the client
> side and stated plainly in `docker logs pds`: the DNS timeout arrives as a signature
> error, the SSRF refusal as a hostname error, and the missing lexicons as a scope error.
> None of the three is what the browser says it is.

---

## Stage 2, Option B — a VM (when you want it always on)

**Get an x86_64 VM.** Hetzner CX22 (~€4.50–6/month; they raised cloud prices in June 2026,
so check current) is ample — 2 vCPU and 4 GB is far more than a family needs.

Everything from Option A applies except the exposure: here the PDS is public, so it uses
its own Caddy and real DNS instead of Tailscale, and handles can live under
`pds.jscarrott.com` with a wildcard record rather than needing
`PDS_SERVICE_HANDLE_DOMAINS`.

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

## Stage 3 — publish the lexicons (or nobody can sign in)

This is not cosmetic, and the rest of these docs used to say it was. **`space?` scopes do
not work until the lexicons resolve.** The authorization server parses the scope, tries to
resolve `com.jscarrott.hyperlocal.space` to find out what it is, fails, and rejects the
whole request as `invalid_scope`. What you see in the app is a sign-in that bounces
straight back with no useful message; what you see in the PDS log is the real cause:

```
queryTxt ENOTFOUND _lexicon.hyperlocal.jscarrott.com
```

Two things are needed, and neither is the app's own deploy.

1. **A TXT record naming the authority's DID.** The authority is the NSID minus its final
   segment, reversed — so `com.jscarrott.hyperlocal.note` resolves via
   **`_lexicon.hyperlocal.jscarrott.com`**, not the bare apex. At Hover the hostname field
   takes the name relative to the domain, so enter `_lexicon.hyperlocal`, not the FQDN;
   typing the whole thing gets you `_lexicon.hyperlocal.jscarrott.com.jscarrott.com`.

   ```
   _lexicon.hyperlocal   TXT   did=did:plc:…
   ```

2. **The schemas, published as records.** Each file in `lexicons/` goes into the
   authority account's repo as a `com.atproto.lexicon.schema` record whose rkey is the
   NSID:

   ```
   com.atproto.lexicon.schema/com.jscarrott.hyperlocal.note
   com.atproto.lexicon.schema/com.jscarrott.hyperlocal.space
   com.atproto.lexicon.schema/com.jscarrott.hyperlocal.permissions
   ```

The DID in the TXT record and the account holding the records must be the same one, and
that account has to be on a PDS the authorization server can reach — which on a tailnet
means Stage 2's DNS fix is already in place.

Sign-in working is the check. The consent screen showing **Hyperlocal** rather than a raw
scope string is the bonus, and the only part that was ever cosmetic.

---

## Stage 4 — the gate, before anyone is invited

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

## Stage 5 — the OSM proxy (optional, do it last)

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

## Stage 6 — bring the family in

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
| PDS on your desktop over Tailscale | £0 |
| PDS on an amd64 VM, later | ~£4.50–6/month |
| Backups | £0 to another disk, £0–1/month to object storage |
| OSM proxy | £0 as a Worker, ~£2/month on Fly |
| **Total, starting on the desktop** | **£0** |
| **Total, once it moves to a VM** | **~£60–90/year** |

Starting on the desktop is not just cheaper, it is the faster way to find out whether the
alpha does what it claims. Move to a VM when the answer is yes and the uptime starts to
annoy you.
