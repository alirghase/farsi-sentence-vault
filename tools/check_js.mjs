// Static checks for the web client, run in CI.
//
// Three things, all of which have gone wrong here and shipped silently, because
// the app is plain ES modules with no build step and nothing else looks at it:
//
//   1. modules import cleanly — a top-level reference to a browser global is a
//      blank page on the phone, not an error anywhere else.
//   2. every `mod.fn(...)` call resolves to something that module exports.
//      Removing a neighbouring function by matching braces has twice walked
//      backwards over a doc comment and taken an extra function with it
//      (renderPassPanel, then undoAttempt). Both times the module still
//      imported fine and the failure waited until the button was pressed.
//   3. every element id and string key the code reaches for exists. A deleted
//      screen leaves $('gate-block') behind; a tidied strings.js deletes a key
//      backup.js still throws.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = resolve(process.argv[2] ?? 'web/js');
const files = readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
const source = new Map(files.map((f) => [f, readFileSync(join(dir, f), 'utf8')]));
const html = readFileSync(resolve('web/index.html'), 'utf8');

const problems = [];

// --- 1. modules import ------------------------------------------------------
for (const file of files) {
  try {
    await import(pathToFileURL(join(dir, file)).href);
    console.log(`  ok    ${file}`);
  } catch (error) {
    console.log(`  FAIL  ${file}`);
    problems.push(`${file}: ${error.message.split('\n')[0]}`);
  }
}

// --- 2. cross-module calls resolve -----------------------------------------
const exportsOf = new Map();
for (const [file, text] of source) {
  exportsOf.set(file, new Set(
    [...text.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)]
      .map((m) => m[1]),
  ));
}

for (const [file, text] of source) {
  // `import * as session from './session.js'` gives us alias -> file.
  const aliases = [...text.matchAll(/import \* as (\w+) from '\.\/([\w.]+)'/g)];
  // The import lines themselves are stripped first, or `from './db.js'` reads
  // as a call to a `js` export on the alias.
  const body = text.replace(/^import .*$/gm, '');
  for (const [, alias, target] of aliases) {
    const available = exportsOf.get(target);
    if (!available) continue;
    for (const [, name] of body.matchAll(new RegExp(`\\b${alias}\\.(\\w+)`, 'g'))) {
      if (!available.has(name)) {
        problems.push(`${file}: ${alias}.${name} is not exported by ${target}`);
      }
    }
  }
}

// --- 3. ids and string keys exist ------------------------------------------
const ids = new Set([...html.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]));
const keys = new Set(
  [...(source.get('strings.js') ?? '').matchAll(/^ {2}'([\w.]+)':/gm)].map((m) => m[1]),
);
// Screens are shown by name, and directions are built from the card.
for (const extra of ['dir.enToFa', 'dir.faToEn']) keys.add(extra);

for (const [file, text] of source) {
  for (const [, id] of text.matchAll(/\$\('([\w-]+)'\)/g)) {
    if (!ids.has(id)) problems.push(`${file}: $('${id}') has no element in index.html`);
  }
  for (const [, key] of text.matchAll(/\bt(?:ext)?\('([\w.]+)'\)/g)) {
    if (!keys.has(key)) problems.push(`${file}: string key '${key}' is not in strings.js`);
  }
}

// data-t in the markup must resolve too.
for (const [, key] of html.matchAll(/data-t="([\w.]+)"/g)) {
  if (!keys.has(key)) problems.push(`index.html: data-t="${key}" is not in strings.js`);
}

const unique = [...new Set(problems)];
for (const problem of unique) console.log(`  FAIL  ${problem}`);
console.log(`\n  ${files.length} modules, ${unique.length} problems`);
process.exit(unique.length ? 1 : 0);
