import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const names = ['E2E_BASE_URL','E2E_SUPABASE_URL','E2E_SUPABASE_ANON_KEY','E2E_BACKEND_URL',
  'E2E_USER_A_ACCESS_TOKEN','E2E_USER_B_ACCESS_TOKEN','E2E_WORKSPACE_A_ID','E2E_WORKSPACE_B_ID',
  'E2E_USER_A_STORAGE_STATE','E2E_USER_B_STORAGE_STATE'];
const missing = names.filter(name => !process.env[name]);
for (const name of ['E2E_USER_A_STORAGE_STATE','E2E_USER_B_STORAGE_STATE']) {
  if (process.env[name] && !existsSync(process.env[name])) missing.push(`${name} file`);
}
if (missing.length || process.env.E2E_ALLOW_SYNTHETIC_PROVIDER_PROCESSING !== 'true') {
  console.error(`BLOCKED: missing authenticated acceptance prerequisites: ${missing.join(', ')}. Explicit synthetic-provider consent is also required.`);
  process.exit(1);
}
const child = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js','test','authenticated-isolation.spec.ts',
  '--project=chromium','--project=mobile-chrome','--workers=1','--trace=off'], { stdio: 'inherit',
  env: { ...process.env, E2E_AUTHENTICATED_REQUIRED: 'true' } });
process.exit(child.status ?? 1);
