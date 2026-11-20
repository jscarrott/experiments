# jj-musubi hub

[jj-musubi](https://www.serpentine.com/software/jj-musubi/) keeps a Jujutsu repository in
sync live across your own machines. Each machine runs a musubi daemon that syncs with a
**hub** over ssh. This add-on is that hub. Home Assistant is usually on all the time, so
it's a good place for one.

The add-on runs two things:

- `musubi hub`, which keeps every hive (a repository shared across machines) in
  `/data/musubi/musubi-hub`. That folder is included in Home Assistant backups.
- An ssh server, on port **2222** by default, that accepts only the `musubi` user and only
  public keys. Machines connect to it and run `musubi hub connect`.

## Setup

1. Add your own ssh public key (the contents of `~/.ssh/id_ed25519.pub`, say) to
   **Authorized keys**. Then start the add-on.

2. On each machine, add a host entry to `~/.ssh/config` for the hub:

   ```
   Host musubi-hub
       HostName homeassistant.local
       Port 2222
       User musubi
   ```

   Check that it works. It should print the hub's musubi version:

   ```sh
   ssh musubi-hub musubi --version
   ```

3. On the first machine, inside the repository you want to share:

   ```sh
   musubi create --hub musubi-hub
   ```

   On the other machines, inside their copy of that repository:

   ```sh
   musubi join --hub musubi-hub
   ```

   or, to make a new copy from the hub:

   ```sh
   musubi clone <hive> ~/src/<hive> --hub musubi-hub
   ```

The first time a machine talks to the hub, musubi makes a key for that machine
(`~/.local/state/musubi/hub_key`). It logs in with your own key and adds the new key to
the hub's `authorized_keys`, limited to running `musubi hub connect`. These machine keys
are stored in `/data/musubi/.ssh/authorized_keys` and are kept across restarts and
updates.

Each machine needs `musubi`, `jj` and `git`. Their versions should match the add-on's
musubi version. musubi 0.47.1 is built against jj 0.47.1, and older `jj` versions can't
read the repositories it writes.

## Options

### `authorized_keys`

Your own public keys, one per list item. Machines need one of these the first time they
join, to enroll their own restricted key. **Anyone with one of these keys gets a shell in
the add-on's container**, as the `musubi` user, with access to every hive. Once all your
machines have joined, you can remove these keys. Enrolled machines keep working.

### `advertise`

Optional. The name other machines use with `--hub`, such as `musubi-hub`. The hub uses it
only in the instructions it prints to the log.

### `log_level`

How much musubi logs: `trace`, `debug`, `info` (the default), `warn` or `error`.

## Network

The add-on's port 22 maps to port 2222 on the host. You can change that under
**Network**. Home Assistant's own SSH add-on can stay on port 22.

If you reach the hub from outside your network, use a VPN such as Tailscale rather than
opening the port to the internet.

## Security

jj-musubi is meant for one person and their machines: anyone who can reach the hub can
read and write every hive on it. Add only your own keys.

To stop a machine reaching the hub, delete its line from `~/.ssh/authorized_keys` on the hub.
Each line ends with `musubi@<hostname>`, the hostname of the machine that enrolled it. While one of your own keys is in **Authorized keys**,
you can do this over ssh:

```sh
ssh musubi-hub "sed -i '/musubi@old-laptop\$/d' ~/.ssh/authorized_keys"
```

Use `musubi forget <machine>` as well, to take the machine's copy out of the hive.

## Updating

The add-on version follows the musubi version. Update musubi on your machines at the same
time as the add-on.
