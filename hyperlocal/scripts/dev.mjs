import { spawn } from 'node:child_process';

// Runs both halves. The web app is usable without the proxy — it just falls back to
// plain pins — so a proxy that dies does not take the dev server with it.
const children = [
  ['places', 'npx', ['tsx', 'place-proxy/server.ts']],
  ['web', 'npx', ['vite']],
].map(([name, command, args]) => {
  const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`[dev] ${name} exited with ${code}`);
  });
  return child;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const child of children) child.kill(signal);
    process.exit(0);
  });
}
