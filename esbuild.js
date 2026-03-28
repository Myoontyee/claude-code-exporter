const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const ctx = esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  platform: 'node',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  logLevel: 'silent',
  plugins: [
    {
      name: 'esbuild-problem-matcher',
      setup(build) {
        build.onStart(() => console.log('[watch] build started'));
        build.onEnd((result) => {
          result.errors.forEach(({ text, location }) => {
            console.error(`✘ [ERROR] ${text}`);
            if (location) console.error(`    ${location.file}:${location.line}:${location.column}`);
          });
          console.log('[watch] build finished');
        });
      },
    },
  ],
});

ctx.then(async (context) => {
  if (watch) {
    await context.watch();
  } else {
    await context.rebuild();
    await context.dispose();
  }
});
