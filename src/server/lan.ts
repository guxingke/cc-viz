import { networkInterfaces } from 'node:os';

function getDefaultRouteInterface(): string | null {
  try {
    if (process.platform === 'darwin') {
      const out = Bun.spawnSync({
        cmd: ['route', '-n', 'get', 'default'],
        stdout: 'pipe',
        stderr: 'pipe',
      }).stdout.toString();
      const m = out.match(/interface:\s*(\S+)/);
      return m?.[1] ?? null;
    }
    if (process.platform === 'linux') {
      const out = Bun.spawnSync({
        cmd: ['ip', 'route', 'show', 'default'],
        stdout: 'pipe',
        stderr: 'pipe',
      }).stdout.toString();
      const m = out.match(/\bdev\s+(\S+)/);
      return m?.[1] ?? null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Returns the IPv4 address of the host's primary LAN interface (the one used
 * for the default route), or the first non-loopback IPv4 as a fallback.
 * Returns null when no LAN address can be determined.
 */
export function getPrimaryLanAddress(): string | null {
  const nets = networkInterfaces();
  const ifaceName = getDefaultRouteInterface();
  if (ifaceName) {
    const v4 = nets[ifaceName]?.find((n) => n.family === 'IPv4' && !n.internal);
    if (v4) return v4.address;
  }
  for (const list of Object.values(nets)) {
    for (const n of list ?? []) {
      if (n.family === 'IPv4' && !n.internal) return n.address;
    }
  }
  return null;
}
