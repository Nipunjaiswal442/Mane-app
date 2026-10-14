import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile, mkdir, copyFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Landing } from '../components/landing';
const require = createRequire(import.meta.url);
const out = path.resolve('out/landing');
await mkdir(path.join(out, 'fonts'), { recursive: true });
let css = (await readFile('app/globals.css', 'utf8')).replace(/@tailwind[^;]+;/g, '');
for (const font of ['anton', 'ibm-plex-mono']) {
  const root = path.dirname(require.resolve(`@fontsource/${font}/package.json`));
  const weights = font === 'anton' ? [400] : [400, 500];
  for (const weight of weights) {
    let fontCss = await readFile(path.join(root, `latin-${weight}.css`), 'utf8');
    fontCss = fontCss.replaceAll('./files/', './fonts/');
    css = fontCss + '\n' + css;
  }
  for (const name of await readdir(path.join(root, 'files'))) {
    if (
      name.includes('-latin-') &&
      !name.includes('-latin-ext-') &&
      weights.some((w) => name.includes(`-${w}-`))
    )
      await copyFile(path.join(root, 'files', name), path.join(out, 'fonts', name));
  }
}
await writeFile(path.join(out, 'style.css'), css);
for (const file of ['architecture.svg', 'corridor.svg'])
  await copyFile(path.join('public', file), path.join(out, file));
const body = renderToStaticMarkup(<Landing />)
  .replaceAll('src="/architecture.svg"', 'src="./architecture.svg"')
  .replaceAll('src="/corridor.svg"', 'src="./corridor.svg"');
await writeFile(
  path.join(out, 'index.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="Private collaboration and local AI meeting minutes. Your network. Your rules."><title>Mane — Same people. Deeper work.</title><link rel="stylesheet" href="./style.css"></head><body>${body}</body></html>`,
);
console.log(`Static landing page exported to ${out}`);
