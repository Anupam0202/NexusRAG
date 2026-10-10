import test from 'node:test';
import assert from 'node:assert/strict';
import { geminiCall } from '../../apps/gateway/src/quota.js';
const id = '11111111-1111-4111-8111-111111111111';
const env = { SUPABASE_URL: 'https://supabase.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic' };
const context = { workspaceId: id, actorId: id, provider: 'gemini', dataClassification: 'non_sensitive', credentialMode: 'user_byok', userApiKey: 'synthetic-user-key' };
for (const state of ['RIGHTS_BLOCKED', 'BYOK_REQUIRED', 'DISABLED', 'REVIEW_REQUIRED']) {
  test(`BYOK ${state} denies before provider operation`, async t => {
    let called = false;
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      assert.equal(url.endsWith('nexus_authorize_byok_processing'), true);
      assert.equal(init.body.includes(context.userApiKey), false);
      assert.equal(new Headers(init.headers).has('x-goog-api-key'), false);
      return new Response(JSON.stringify({ state }));
    });
    await assert.rejects(geminiCall(env, context, { requests: 1 }, async () => { called = true; }), e => ['RIGHTS_BLOCKED', 'BYOK_REQUIRED'].includes(e.code));
    assert.equal(called, false);
  });
}
test('BYOK without explicit actor or non-sensitive scope makes no external call', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw Error('No call authorized'); });
  for (const extra of [{ actorId: undefined }, { dataClassification: 'unknown' }, { action: 'send_all_data' }])
    await assert.rejects(geminiCall(env, { ...context, ...extra }, { requests: 1 }, async () => { calls++; }), e => e.code === 'RIGHTS_BLOCKED');
  assert.equal(calls, 0);
});
test('missing BYOK schema fails closed instead of charging platform quota or bypassing review', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('missing', { status: 404 }));
  await assert.rejects(geminiCall(env, context, { requests: 1 }, async () => assert.fail('provider must not run')), e => e.code === 'MIGRATION_REQUIRED');
});
