// Syntax/import check for the web client's modules.
//
// Node has no DOM or IndexedDB, so this only catches syntax errors and
// top-level references to browser globals — which is exactly the class of bug
// that otherwise shows up as a blank page on the phone.
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = resolve(process.argv[2] ?? 'web/js');
const files = readdirSync(dir).filter((f) => f.endsWith('.js')).sort();

let failed = 0;
for (const file of files) {
  try {
    await import(pathToFileURL(join(dir, file)).href);
    console.log(`  ok    ${file}`);
  } catch (error) {
    // A module that only touches browser APIs inside functions imports fine.
    // One that touches them at top level fails here — a real bug.
    console.log(`  FAIL  ${file}`);
    console.log(`        ${error.message.split('\n')[0]}`);
    failed++;
  }
}
console.log(`\n  ${files.length} modules, ${failed} failing`);
process.exit(failed ? 1 : 0);
