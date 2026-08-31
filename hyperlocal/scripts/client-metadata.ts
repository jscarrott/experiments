/**
 * Write the OAuth client metadata for a deployed origin.
 *
 * In production the `client_id` must be a public HTTPS URL that serves this exact
 * document, and the scope in it has to match what the app asks for, or the
 * authorization server rejects the request. Generating it from one constant is the
 * only way to keep those two in step.
 *
 *   PUBLIC_URL=https://hyperlocal.example npm run client-metadata
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OAUTH_SCOPE } from '../shared/scope.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const publicUrl = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
if (!publicUrl.startsWith('https://')) {
  console.error('PUBLIC_URL must be set to the https origin the app is served from');
  process.exit(2);
}

const metadata = {
  client_id: `${publicUrl}/client-metadata.json`,
  client_name: 'Hyperlocal',
  client_uri: publicUrl,
  redirect_uris: [`${publicUrl}/`],
  scope: OAUTH_SCOPE,
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
  application_type: 'web',
  dpop_bound_access_tokens: true,
};

mkdirSync(join(root, 'public'), { recursive: true });
const out = join(root, 'public', 'client-metadata.json');
writeFileSync(out, JSON.stringify(metadata, null, 2) + '\n');
console.log(`wrote ${out} for ${publicUrl}`);
