import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './server.mjs';
test('GET /health returns JSON status ok', async () => {
  const server = createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await response.json(), { status: 'ok' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
