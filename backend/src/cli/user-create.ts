import { parseArgs } from 'node:util';
import { cliIdentity, generatePassword, runCli } from './shared.js';

/**
 * npm run user:create -- --email a@b.c --name "Nama" --role admin|viewer
 * Without --password a random one is generated and printed ONCE.
 */
const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string', default: 'viewer' },
    password: { type: 'string' },
  },
});

if (!values.email || !values.name || (values.role !== 'admin' && values.role !== 'viewer')) {
  console.error('Pemakaian: npm run user:create -- --email <email> --name "<nama>" --role admin|viewer [--password <pw>]');
  process.exit(1);
}

const { sql, identity } = cliIdentity();
await runCli(async () => {
  const password = values.password ?? generatePassword();
  const user = await identity.createUser({
    email: values.email!,
    name: values.name!,
    role: values.role as 'admin' | 'viewer',
    password,
  });
  console.log(`User dibuat: ${user.email} (${user.role})`);
  if (!values.password) console.log(`Password (simpan sekarang, tidak ditampilkan lagi): ${password}`);
}, sql);
