import { test, expect } from '@playwright/test';
import { mkdtemp, cp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import scope from '../../examples/scope.json' with { type: 'json' };
test('real checks, SSE updates, invalidation, prompt and connection views', async ({
  page,
  request,
}, info) => {
  const repo = await mkdtemp(join(tmpdir(), 'ap-ui-'));
  await cp(resolve('examples/health-api'), repo, { recursive: true });
  try {
    const { token } = await (await request.get('/api/bootstrap')).json();
    const headers = { 'X-Agent-Progress-Token': token };
    const s = await (
      await request.post('/api/sessions', {
        headers,
        data: { ...scope, repoPath: repo, title: `UI integration ${info.project.name}` },
      })
    ).json();
    await request.post(`/api/sessions/${s.id}/verify`, { headers, data: {} });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await page
      .getByRole('button', { name: new RegExp(`UI integration ${info.project.name}`) })
      .click();
    await expect(page.getByTestId('progress')).toHaveText('80%');
    await expect(page.getByText('3 of 4 requirements verified')).toBeVisible();
    await page.getByText('Health endpoint returns 200 and JSON status ok', { exact: true }).click();
    await expect(
      page.getByText('Observer independently ran the trusted check; exit code 0.').first(),
    ).toBeVisible();
    await writeFile(join(repo, 'API.md'), 'GET /health returns status ok.');
    await expect(page.getByTestId('progress')).toHaveText('0%', { timeout: 10000 });
    await page.getByRole('button', { name: 'Run verification' }).click();
    await expect(page.getByTestId('progress')).toHaveText('100%');
    await page.getByRole('tab', { name: 'Original prompt' }).click();
    await expect(page.getByRole('heading', { name: 'The original request' })).toBeVisible();
    await page.getByRole('tab', { name: 'Connection' }).click();
    await expect(page.getByRole('heading', { name: 'Connect your Codex stream' })).toBeVisible();
    await page.getByRole('tab', { name: 'Requirements' }).click();
    await request.post(`/api/sessions/${s.id}/events`, {
      headers,
      data: [{ deliveryId: '1', event: { type: 'turn.started' } }],
    });
    await expect(page.getByText('Codex is working', { exact: true }).first()).toBeVisible();
    await request.post(`/api/sessions/${s.id}/disconnect`, { headers, data: {} });
    await expect(page.getByText('Observation interrupted.', { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
    await page.screenshot({ path: `artifacts/dashboard-${info.project.name}.png`, fullPage: true });
  } finally {
    await rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
test('creates a session by reviewing a locally drafted scope', async ({ page }, info) => {
  const repo = await mkdtemp(join(tmpdir(), 'ap-ui-create-'));
  await writeFile(join(repo, 'hello.txt'), 'hello');
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'New tracking session' }).click();
    await page
      .getByLabel('Session name', { exact: true })
      .fill(`Created in browser ${info.project.name}`);
    await page.getByLabel('Repository path', { exact: true }).fill(repo);
    await page.getByLabel('Original coding prompt').fill('Create hello.txt');
    await page.getByRole('button', { name: 'Break prompt into draft criteria' }).click();
    await page.getByLabel('Verification method').selectOption('file');
    await page.getByLabel('Relative file path').fill('hello.txt');
    await page.getByLabel('I reviewed the criteria', { exact: false }).check();
    await page.getByRole('button', { name: 'Lock scope & create session' }).click();
    await expect(
      page.getByRole('heading', { name: `Created in browser ${info.project.name}` }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Run verification' }).click();
    await expect(page.getByTestId('progress')).toHaveText('100%');
    await page.reload();
    await expect(page.getByTestId('progress')).toHaveText('100%');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
