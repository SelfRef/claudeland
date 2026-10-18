import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const uuid = 'claudeland@fabiosm46.dev';

run('pnpm', ['dev:install']);

// GNOME 49+ replaced --nested with Mutter DevKit; ask the binary which it has.
const help = spawnSync('gnome-shell', ['--help'], { encoding: 'utf8' });
if (help.error) {
  console.error('gnome-shell is not available in PATH');
  process.exit(1);
}
const mode = `${help.stdout}${help.stderr}`.includes('--devkit') ? '--devkit' : '--nested';
// Without the viewer the shell runs headless and shows nothing.
if (
  mode === '--devkit' &&
  !['/usr/lib/mutter-devkit', '/usr/libexec/mutter-devkit'].some((path) => existsSync(path))
) {
  console.error('Mutter DevKit is not installed (Arch: mutter-devkit, Ubuntu: mutter-dev-bin)');
  process.exit(1);
}

// A private dconf database keeps the nested session from enabling the
// extension, or changing its settings, in the desktop you are working in.
// It persists between runs; `pnpm clean` resets it.
const config = resolve(root, 'build/nested');
await mkdir(config, { recursive: true });
const shell = spawnSync(
  'dbus-run-session',
  [
    '--',
    'sh',
    '-c',
    `gsettings set org.gnome.shell enabled-extensions "['${uuid}']" && exec gnome-shell ${mode} --wayland`,
  ],
  { cwd: root, env: { ...process.env, XDG_CONFIG_HOME: config }, stdio: 'inherit' },
);
process.exit(shell.status ?? 1);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
