import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

if (process.platform !== 'win32' || Number(process.versions.node.split('.')[0]) < 26) {
  throw new Error('Building the Windows executable requires Node.js 26 or newer on Windows.');
}

const outputDir = path.resolve('release');
const output = path.join(outputDir, `St-Johns-River-Watch-windows-${process.arch}.exe`);
mkdirSync(outputDir, { recursive: true });

const dist = path.resolve('dist');
const assets = Object.fromEntries(
  readdirSync(dist, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const filename = path.join(entry.parentPath, entry.name);
      return [path.relative(dist, filename).split(path.sep).join('/'), filename];
    }),
);

const config = path.join(outputDir, 'sea-config.json');
writeFileSync(config, JSON.stringify({
  main: path.resolve('dist-server', 'index.js'),
  mainFormat: 'module',
  output,
  disableExperimentalSEAWarning: true,
  execArgvExtension: 'none',
  assets,
}));
try {
  execFileSync(process.execPath, [`--build-sea=${config}`], { stdio: 'inherit' });
} finally {
  unlinkSync(config);
}
console.log(output);
