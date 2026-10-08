import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteQdrantDocument, verifyQdrantGeneration } from '../../apps/gateway/src/worker-lifecycle.js';
const workspace = '11111111-1111-4111-8111-111111111111';
const env = { SUPABASE_URL: 'https://supabase.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic', QDRANT_URL: 'https://qdrant.invalid', QDRANT_API_KEY: 'synthetic' };
const json = data => new Response(JSON.stringify(data));
function mock(t, countResult, { unavailable = false } = {}) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('v6_reserve_many')) return json({ state: 'READY', reservations: [{ id: workspace, amount: JSON.parse(init.body).p_dimensions.requests }] });
    if (url.endsWith('v6_settle_many')) return json({ state: 'SETTLED' });
    assert.ok(init.signal instanceof AbortSignal);
    if (unavailable) throw new DOMException('Synthetic timeout', 'TimeoutError');
    if (url.includes('/points/delete')) return json({ status: 'ok' });
    if (url.endsWith('/points/count')) return countResult instanceof Response ? countResult : json(countResult);
    throw Error('Unexpected provider call');
  });
  return calls;
}
for (const [label, body] of [
  ['missing result', {}], ['missing count', { result: {} }],
  ['null', { result: { count: null } }], ['string zero', { result: { count: '0' } }],
  ['negative', { result: { count: -1 } }], ['fractional', { result: { count: 0.5 } }],
  ['unsafe integer', { result: { count: Number.MAX_SAFE_INTEGER + 1 } }],
  ['remaining vectors', { result: { count: 1 } }],
]) {
  test(`deletion does not accept ${label} as proof of zero vectors`, async t => {
    const calls = mock(t, body);
    await assert.rejects(deleteQdrantDocument(env, workspace, workspace), e => e.code === 'QDRANT_DELETE_UNVERIFIED' && e.retryable);
    assert.equal(calls.at(-1).url.endsWith('v6_settle_many'), true);
    assert.equal(JSON.parse(calls.at(-1).init.body).p_provider_called, true);
  });
}
test('only exact numeric zero verifies provider deletion with tenant-fenced count', async t => {
  const calls = mock(t, { result: { count: 0 } });
  assert.deepEqual(await deleteQdrantDocument(env, workspace, workspace), { verified: true });
  const providerCalls = calls.filter(c => c.url.startsWith(env.QDRANT_URL));
  assert.equal(providerCalls.length, 2);
  assert.equal(JSON.parse(providerCalls[1].init.body).exact, true);
  for (const call of providerCalls) assert.equal(JSON.parse(call.init.body).filter.must[0].match.value, workspace);
});
test('malformed count JSON cannot create a deletion proof', async t => {
  mock(t, new Response('{invalid'));
  await assert.rejects(deleteQdrantDocument(env, workspace, workspace), e => e.code === 'QDRANT_DELETE_UNVERIFIED');
});
test('provider timeout is retryable and conservatively settled, never successful', async t => {
  const calls = mock(t, null, { unavailable: true });
  await assert.rejects(deleteQdrantDocument(env, workspace, workspace), e => e.code === 'PROVIDER_UNAVAILABLE' && e.retryable);
  assert.equal(JSON.parse(calls.at(-1).init.body).p_provider_called, true);
});
test('publication count rejects coercible values instead of asserting readiness', async t => {
  mock(t, { result: { count: '1' } });
  await assert.rejects(verifyQdrantGeneration(env, workspace, workspace, workspace, 'generation', 1), e => e.code === 'QDRANT_INDEX_UNVERIFIED');
});
