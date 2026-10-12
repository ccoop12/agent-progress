import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import type { Evidence, Requirement } from '../shared/model';
import { fileHash, inside } from './repository';
export async function verifyRequirement(
  root: string,
  r: Requirement,
  allowCommands: boolean,
): Promise<Evidence> {
  const at = new Date().toISOString();
  const result = (
    status: Evidence['status'],
    summary: string,
    exitCode?: number | null,
  ): Evidence => ({ at, status, summary, exitCode });
  try {
    const check = r.check;
    if (check.kind === 'manual')
      return result('manual', 'Requires human review; no automatic completion credit.');
    if (check.kind === 'file') {
      const path = await inside(root, check.path);
      if (!(await stat(path)).isFile()) return result('failed', 'Expected a regular file.');
      if (check.contains !== undefined && !(await readFile(path, 'utf8')).includes(check.contains))
        return result('failed', 'Required literal text was not found.');
      return result(
        'verified',
        check.contains === undefined
          ? 'File exists. This checks presence only.'
          : 'File contains the required literal text. This is a static assertion.',
      );
    }
    if (!allowCommands)
      return result('blocked', 'Commands were not authorized when scope was locked.');
    for (const path of check.trustedFiles) {
      if ((await fileHash(root, path)) !== r.trustedHashes?.[path])
        return result(
          'blocked',
          'Trusted verifier changed. Review it and create a new scope before granting credit.',
        );
    }
    return await new Promise<Evidence>((resolve) => {
      // No shell, no raw output capture, and a deliberately small inherited environment.
      const env: NodeJS.ProcessEnv = {};
      for (const name of [
        'PATH',
        'Path',
        'SystemRoot',
        'WINDIR',
        'TEMP',
        'TMP',
        'HOME',
        'USERPROFILE',
        'PATHEXT',
      ])
        if (process.env[name]) env[name] = process.env[name];
      env.CI = '1';
      env.NO_COLOR = '1';
      const child = spawn(check.executable, check.args, {
        cwd: root,
        env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: 'ignore',
      });
      let settled = false,
        timedOut = false;
      const finish = (e: Evidence) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(e);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        if (child.pid) {
          if (process.platform === 'win32') {
            const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
              windowsHide: true,
              stdio: 'ignore',
            });
            killer.on('error', () => child.kill('SIGKILL'));
            killer.on('close', (code) => {
              if (code !== 0) child.kill('SIGKILL');
            });
          } else {
            try {
              process.kill(-child.pid, 'SIGKILL');
            } catch {
              child.kill('SIGKILL');
            }
          }
        }
      }, check.timeoutMs);
      child.on('error', () =>
        finish(result('blocked', 'Could not start the trusted verifier executable.')),
      );
      child.on('close', (code) =>
        finish(
          timedOut
            ? result('failed', 'Verification timed out; no completion credit.')
            : result(
                code === 0 ? 'verified' : 'failed',
                code === 0
                  ? 'Observer independently ran the trusted check; exit code 0.'
                  : 'Trusted check failed. Run it in your terminal for details.',
                code,
              ),
        ),
      );
    });
  } catch {
    return result('failed', 'Evidence could not be read safely, or a required file is missing.');
  }
}
