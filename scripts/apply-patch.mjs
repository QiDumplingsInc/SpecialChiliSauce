// scripts/apply-patch.mjs -- the offline submit path for admin edit mode.
//
// Edit mode in the browser has no backend and holds no credential, so its
// Submit button cannot open a pull request by itself. Instead it downloads a
// patch file describing which wording changed, and this script turns that file
// into a reviewable change on disk: it validates the patch through the
// fail-closed gate in content-patch.mjs, writes the content files, and
// regenerates the gallery pages from the new data. The reviewer then reads a
// normal `git diff` and commits it the way they commit anything else.
//
// This script deliberately performs no git operation and no network call. It
// writes content/*.json and the generated gallery pages, nothing else, so the
// worst case is a working-tree change that `git checkout` undoes. Branching,
// committing and pushing stay with the person running it.
//
// Run: node scripts/apply-patch.mjs <patch-file>
//      node scripts/apply-patch.mjs <patch-file> --dry-run

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyContentPatch, EDITABLE_CONTENT } from './content-patch.mjs';

const repoRoot = path.resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Validate a downloaded edit-mode patch file and apply it to the content files
 * and the generated pages.
 *
 * Input: `patchPath` is the path to the `.json` file the browser downloaded,
 * and its contents are treated as entirely untrusted. `options.contentRoot` is
 * the directory holding `content/`, defaulting to the repository root;
 * `options.dryRun` runs every check and reports the same summary without
 * writing, which is what a reviewer uses to see what a patch would do before
 * letting it touch the tree; `options.buildCommand` is a `[command, args]`
 * pair overriding how the gallery build is invoked, used by tests to exercise
 * the build-failure path.
 *
 * Output: `{ ok, errors, changed, built, files, summary }`. `ok` is false when
 * any step failed, in which case `errors` lists every reason and the content
 * files are left byte for byte as they were. `changed` is false when the patch
 * was valid but every value already matched what is on disk. `built` records
 * whether the gallery build actually ran, which is false for a rejected patch,
 * a no-op patch and a dry run. `files` and `summary` are the content gate's,
 * one summary entry per real change.
 *
 * Process: read and parse the patch file, snapshot every editable content file
 * so a later failure can be undone, then hand the patch to applyContentPatch,
 * which is all-or-nothing and writes nothing if any check fails. A patch that
 * changed something is followed by the gallery build, because content and
 * generated HTML have to move together; a content edit that skipped the build
 * would look like a correct JSON diff next to a stale page. If the build
 * fails, the snapshots are restored so a failed submit leaves nothing behind.
 *
 * Failure modes: returns `ok: false` with populated `errors` for an unreadable
 * or malformed patch file, any patch the content gate rejects, and a failing
 * build. It throws only on a genuinely unexpected filesystem error.
 */
export function applyPatchFile(patchPath, options = {}) {
  const contentRoot = options.contentRoot ?? repoRoot;
  const dryRun = options.dryRun === true;
  const refused = { ok: false, errors: [], changed: false, built: false, files: [], summary: [] };

  let raw;
  try {
    raw = readFileSync(patchPath, 'utf8');
  } catch (cause) {
    refused.errors.push(`${patchPath}: cannot be read (${cause.code ?? cause.message})`);
    return refused;
  }

  let patch;
  try {
    patch = JSON.parse(raw);
  } catch (cause) {
    refused.errors.push(`${patchPath}: is not valid JSON (${cause.message})`);
    return refused;
  }

  const snapshots = new Map();
  for (const file of Object.keys(EDITABLE_CONTENT)) {
    const absolute = path.join(contentRoot, file);
    if (existsSync(absolute)) snapshots.set(absolute, readFileSync(absolute, 'utf8'));
  }

  // The gate writes each touched content file in a loop, so a write that fails
  // partway through a multi-file patch leaves one file rewritten and the next
  // one not. Recovering from that is this script's job, not the gate's: restore
  // every snapshot and report the submission as refused.
  let patched;
  try {
    patched = applyContentPatch(patch, { contentRoot, dryRun });
  } catch (cause) {
    for (const [absolute, contents] of snapshots) {
      if (!existsSync(absolute) || readFileSync(absolute, 'utf8') !== contents) writeFileSync(absolute, contents);
    }
    return {
      ok: false,
      errors: [`a content file could not be written, so every content change was rolled back: ${cause.message}`],
      changed: false,
      built: false,
      files: [],
      summary: [],
    };
  }
  if (!patched.ok) {
    return { ok: false, errors: patched.errors, changed: false, built: false, files: [], summary: [] };
  }  if (!patched.changed) {
    return { ok: true, errors: [], changed: false, built: false, files: [], summary: [] };
  }
  if (dryRun) {
    return { ok: true, errors: [], changed: true, built: false, files: patched.files, summary: patched.summary };
  }

  const [command, args] = options.buildCommand ?? [
    process.execPath,
    contentRoot === repoRoot ? ['build.mjs'] : ['build.mjs', '--fixture', contentRoot],
  ];
  const build = spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8' });
  if (build.status !== 0) {
    for (const [absolute, contents] of snapshots) {
      if (!existsSync(absolute) || readFileSync(absolute, 'utf8') !== contents) writeFileSync(absolute, contents);
    }
    const detail = build.error ? build.error.message : `exit code ${build.status}\n${build.stderr ?? ''}`.trim();
    return {
      ok: false,
      errors: [`gallery build failed, so the content changes were rolled back: ${detail}`],
      changed: false,
      built: false,
      files: [],
      summary: [],
    };
  }

  return { ok: true, errors: [], changed: true, built: true, files: patched.files, summary: patched.summary };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const positional = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
  const dryRun = process.argv.includes('--dry-run');
  if (positional.length !== 1) {
    process.stderr.write(
      'Usage: node scripts/apply-patch.mjs <patch-file> [--dry-run]\n\n' +
        'Applies a patch file downloaded from admin edit mode, then regenerates\n' +
        'the gallery pages. Performs no git operation: review the result with\n' +
        '`git diff` and commit it yourself.\n'
    );
    process.exit(2);
  }

  const outcome = applyPatchFile(positional[0], { dryRun });
  if (!outcome.ok) {
    process.stderr.write(`Patch refused. Nothing was changed.\n\n${outcome.errors.map((line) => `  - ${line}`).join('\n')}\n`);
    process.exit(1);
  }
  if (!outcome.changed) {
    process.stdout.write('Patch is valid but every value already matches the site. Nothing to do.\n');
    process.exit(0);
  }

  const heading = dryRun ? 'Patch is valid. It would make these changes:' : 'Patch applied. These values changed:';
  process.stdout.write(`${heading}\n\n`);
  for (const entry of outcome.summary) {
    process.stdout.write(`  ${entry.key} / ${entry.field}\n    before: ${JSON.stringify(entry.before)}\n    after:  ${JSON.stringify(entry.after)}\n`);
  }
  process.stdout.write(
    dryRun
      ? '\nRun again without --dry-run to apply it.\n'
      : `\nContent files written: ${outcome.files.join(', ')}\nGallery pages regenerated.\n\nReview it with:  git diff\n`
  );
}
