import { existsSync } from 'node:fs';
import { join } from 'node:path';
import index from './src/index.html';
import { authDisabled, loadToken } from './src/server/auth';
import { handleApi } from './src/server/routes';

const { token: AUTH_TOKEN, generated: TOKEN_GENERATED } = loadToken();

// Build CSS once (sync), then start a watcher when developing.
const watch = !process.env.NO_CSS_WATCH;
const cliPath = join(import.meta.dir, 'node_modules', '.bin', 'tailwindcss');
const cssIn = join(import.meta.dir, 'src', 'styles.css');
const cssOut = join(import.meta.dir, 'src', 'styles.built.css');

if (existsSync(cliPath)) {
  // One-shot initial build so the first request has CSS.
  const built = Bun.spawnSync({
    cmd: [cliPath, '-i', cssIn, '-o', cssOut],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (built.exitCode !== 0) {
    console.warn('[tailwind] initial build failed:', built.stderr.toString());
  }
  if (watch) {
    const proc = Bun.spawn({
      cmd: [cliPath, '-i', cssIn, '-o', cssOut, '--watch'],
      stdout: 'inherit',
      stderr: 'inherit',
    });
    const shutdown = () => {
      proc.kill();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
} else if (!existsSync(cssOut)) {
  console.warn('[tailwind] CLI missing and no built CSS — page will be unstyled.');
}

const port = Number(process.env.PORT) || 3456;

const server = Bun.serve({
  port,
  development: true,
  routes: {
    '/': index,
    '/sessions/:id': index,
    '/share/:token': index,
    '/api/*': (req) => handleApi(req),
  },
  error(err) {
    console.error(err);
    return new Response(
      JSON.stringify({ error: err.message ?? 'internal_error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  },
});

const baseUrl = `http://localhost:${server.port}`;
const openUrl = authDisabled() ? baseUrl : `${baseUrl}/?token=${AUTH_TOKEN}`;

console.log(`→ Claude Viz running at ${baseUrl}`);
if (authDisabled()) {
  console.log('  ⚠️  CC_VIZ_NO_AUTH=1 — authentication disabled');
} else {
  console.log(`  Open: ${openUrl}`);
  if (TOKEN_GENERATED) {
    console.log(
      '  ⚠️  CC_VIZ_TOKEN not set — generated an ephemeral token (resets on restart).',
    );
    console.log(`     To pin it: export CC_VIZ_TOKEN=${AUTH_TOKEN}`);
  }
}

if (process.env.CC_VIZ_OPEN) {
  const opener =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'start'
        : 'xdg-open';
  try {
    Bun.spawn([opener, openUrl]);
  } catch {
    // ignore; user can open the URL manually
  }
}
