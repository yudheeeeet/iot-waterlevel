import { parseArgs } from 'node:util';
import { cliIdentity, generatePassword, runCli } from './shared.js';

/**
 * npm run user:reset-password -- --email a@b.c [--password <pw>]
 * Revokes all sessions of the user. Without --password a random one is generated and printed ONCE.
 */
const { values } = parseArgs({
  options: { email: { type: 'string' }, password: { type: 'string' } },
});

if (!values.email) {
  console.error('Pemakaian: npm run user:reset-password -- --email <email> [--password <pw>]');
  process.exit(1);
}

const { sql, identity } = cliIdentity();
await runCli(async () => {
  const password = values.password ?? generatePassword();
  await identity.resetPassword(values.email!, password);
  console.log(`Password ${values.email} direset; semua sesi lama dicabut.`);
  if (!values.password) console.log(`Password baru (simpan sekarang, tidak ditampilkan lagi): ${password}`);
}, sql);
