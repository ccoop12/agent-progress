import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
export const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const excluded = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.agent-progress',
  '.next',
  '.cache',
  'test-results',
  'playwright-report',
]);
export async function inside(root: string, path: string): Promise<string> {
  if (isAbsolute(path) || path.includes('\0'))
    throw new Error('Evidence paths must be relative to the repository');
  const base = await realpath(root),
    full = resolve(base, path),
    rel = relative(base, full);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error('Evidence path escapes repository');
  let current = base;
  for (const segment of rel.split(sep).filter(Boolean)) {
    current = join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error('Symlinks are not accepted as evidence');
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  return full;
}
export async function fileHash(root: string, path: string) {
  const resolved = await inside(root, path);
  const info = await lstat(resolved);
  if (!info.isFile() || info.size > 100 * 1024 * 1024)
    throw new Error('Evidence must be a regular file no larger than 100 MB');
  return sha(await readFile(resolved));
}
export async function fingerprint(root: string, evidencePaths: string[] = []): Promise<string> {
  const digest = createHash('sha256');
  let files = 0,
    bytes = 0;
  async function walk(dir: string, prefix: string) {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      if (excluded.has(entry.name)) continue;
      const path = join(dir, entry.name),
        name = `${prefix}${entry.name}`;
      if (entry.isSymbolicLink())
        throw new Error('Repository contains a symlink; verification is unavailable in this MVP');
      if (entry.isDirectory()) await walk(path, `${name}/`);
      else if (entry.isFile()) {
        if (++files > 20000) throw new Error('Repository exceeds 20,000 observed files');
        const stat = await lstat(path);
        bytes += stat.size;
        if (bytes > 100 * 1024 * 1024)
          throw new Error('Repository exceeds 100 MB of observed files');
        digest
          .update(name)
          .update('\0')
          .update(sha(await readFile(path)))
          .update('\0');
      }
    }
  }
  await walk(root, '');
  // Explicit evidence is observed even when it lives in an excluded build directory.
  for (const path of [...new Set(evidencePaths)].sort()) {
    digest.update(`evidence:${path}\0`);
    try {
      digest.update(await fileHash(root, path));
    } catch (e: any) {
      if (e.code === 'ENOENT') digest.update('MISSING');
      else throw e;
    }
  }
  return digest.digest('hex');
}
