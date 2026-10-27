// Bundles the official Anthropic SDK into one local ESM file (the site never loads it from a CDN).
import { copyFileSync } from 'node:fs';
import { build } from 'esbuild';

await build({
  stdin: { contents: "export { default } from '@anthropic-ai/sdk';", resolveDir: process.cwd(), loader: 'js' },
  outfile: 'vendor/anthropic-sdk.mjs', bundle: true, format: 'esm', platform: 'browser', minify: true, legalComments: 'eof',
});
copyFileSync('node_modules/@anthropic-ai/sdk/LICENSE', 'vendor/LICENSE-anthropic-sdk'); // Apache-2.0: ships with the bundle
