import { cliIdentity, generatePassword, runCli } from './shared.js';

/**
 * npm run db:seed — creates a demo admin and viewer if they do not exist yet.
 * Passwords are generated and printed ONCE. Example devices are added in Task 6 (they need broker accounts).
 */
const ACCOUNTS = [
  { email: 'admin@baruna.local', name: 'Admin Baruna', role: 'admin' as const },
  { email: 'viewer@baruna.local', name: 'Viewer Demo', role: 'viewer' as const },
];

const { sql, identity } = cliIdentity();
await runCli(async () => {
  for (const acc of ACCOUNTS) {
    const exists = await sql`select 1 from users where email = ${acc.email}`;
    if (exists.length) {
      console.log(`- ${acc.email} sudah ada (dilewati)`);
      continue;
    }
    const password = generatePassword();
    await identity.createUser({ ...acc, password });
    console.log(`+ ${acc.email} (${acc.role})  password: ${password}`);
  }
  console.log('Simpan password di atas sekarang; tidak akan ditampilkan lagi.');
}, sql);
