import * as esbuild from 'esbuild';
import * as fs from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const toolDir = resolve(rootDir, 'src/.opencode/tool');
const outDir = resolve(rootDir, 'src/.opencode-runtime/tool');

fs.mkdirSync(outDir, { recursive: true });

const files = fs.readdirSync(toolDir).filter(f => f.endsWith('.ts'));
for (const file of files) {
  await esbuild.build({
    entryPoints: [resolve(toolDir, file)],
    outfile: resolve(outDir, file.replace('.ts', '.js')),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    plugins: [{
      name: 'path-alias',
      setup(build) {
        build.onResolve({ filter: /^@\// }, (args) => {
          let importPath = args.path.replace(/^@\//, '');
          importPath = importPath.replace(/\.js$/, '.ts');
          return { path: resolve(rootDir, 'src', importPath) };
        });
      },
    }],
    external: ['@opencode-ai/plugin'],
  });
  console.log('Bundled:', file);
}
console.log('Done!');
