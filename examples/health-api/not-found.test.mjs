import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './server.mjs';
test('unknown routes return 404', async () => {
  const server = createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/missing`)).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
