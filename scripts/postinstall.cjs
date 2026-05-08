#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const entrypoint = path.join(__dirname, '..', 'dist', 'postinstall.js');

if (!fs.existsSync(entrypoint)) {
  console.log('Quality GC skill auto-install skipped because the package has not been built yet.');
  console.log('After build, run: npx quality-gc install-skill --target codex --scope project --root . --apply');
  process.exit(0);
}

import(pathToFileURL(entrypoint).href)
  .then(module => module.runPostinstall())
  .catch(error => {
    console.error(`[quality-gc] Skill auto-install skipped: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(0);
  });
