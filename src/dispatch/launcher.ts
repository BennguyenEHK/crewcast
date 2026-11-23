import { access, readFile } from 'node:fs/promises';
import { delimiter, dirname, extname, isAbsolute, join } from 'node:path';

// Resolves a worker command to a directly-spawnable (cmd, prefixArgs) so a Windows npm .cmd/.ps1 shim launches without a shell.
// The worker's prompt is untrusted and must never reach a shell (§3), so a shim is turned into `node <cli.js>` instead.
export async function resolveLauncher(bin: string, opts: { path?: string; pathext?: string } = {}): Promise<{ cmd: string; prefixArgs: string[] }> {
  const resolved = await which(bin, opts.path ?? process.env.PATH ?? '', opts.pathext ?? process.env.PATHEXT ?? (process.platform === 'win32' ? '.COM;.EXE;.BAT;.CMD;.PS1' : ''));
  if (!resolved) return { cmd: bin, prefixArgs: [] }; // not found → let spawn fail, recorded as a failed worker (never a crash)
  const ext = extname(resolved).toLowerCase();
  if (ext === '.cmd' || ext === '.ps1' || ext === '.bat') {
    const js = await nodeTarget(resolved);
    if (js) return { cmd: process.execPath, prefixArgs: [js] }; // node <cli.js>
    return { cmd: resolved, prefixArgs: [] }; // a non-node shim: spawn will fail honestly rather than go through a shell
  }
  return { cmd: resolved, prefixArgs: [] }; // a real executable
}

// Finds bin on PATH, trying each PATHEXT extension (npm shims are lowercase). Returns the first existing absolute path.
async function which(bin: string, path: string, pathext: string): Promise<string | null> {
  if (isAbsolute(bin)) return (await exists(bin)) ? bin : null;
  // Try real extensions before the bare name: on Windows the extensionless npm file is a bash shim, not a runnable executable.
  const exts = extname(bin) ? [''] : [...pathext.split(';').map(e => e.trim().toLowerCase()).filter(Boolean), ''];
  for (const dir of path.split(delimiter).filter(Boolean)) {
    for (const e of exts) {
      const candidate = join(dir, bin + e);
      if (await exists(candidate)) return candidate;
    }
  }
  return null;
}

// Reads an npm shim and extracts the `node_modules/.../*.js` entry it runs, resolved against the shim's directory.
async function nodeTarget(shim: string): Promise<string | null> {
  let text: string;
  try { text = await readFile(shim, 'utf8'); } catch { return null; }
  const m = /node_modules[\\/][^"'\s]+?\.[cm]?js/i.exec(text);
  if (!m) return null;
  return join(dirname(shim), m[0].replace(/\\/g, '/'));
}

const exists = (p: string): Promise<boolean> => access(p).then(() => true, () => false);
