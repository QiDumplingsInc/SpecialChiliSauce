// scripts/content-patch.mjs -- the only write path from the browser admin edit
// mode into the repository's content files.
//
// The admin edit mode in the browser never patches HTML and never touches git.
// It collects the editor's text changes into a patch document and submits it
// here, server side, where this module validates the patch against a hard
// whitelist and applies it to content/*.json. The gallery build then
// regenerates the HTML from that data, so a one-word edit in the browser
// becomes a one-line JSON diff in a pull request that a reviewer can read at a
// glance.
//
// Everything about this module fails closed. The patch is all or nothing: one
// bad edit rejects the whole submission and writes nothing. Only the fields
// named in EDITABLE_CONTENT can be reached, only on records that already
// exist, so edit mode can change wording but can never create or delete a
// work, re-point an image, change a medium slug, or alter any value the build
// treats as structure.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const MAX_EDITS_PER_PATCH = 200;
// A hard ceiling on any raw string value, applied before trim() and well above
// the largest per-field limit. Without it a multi-megabyte value was accepted
// into the patch and copied once by trim() before being rejected on length.
const MAX_RAW_VALUE_LENGTH = 4096;

/**
 * The complete set of content a signed-in editor may change, keyed by content
 * file, then by the array inside that file, then by field.
 *
 * `keyField` is the property that addresses one record inside the array, and
 * `fields` is the whitelist for that record. A field absent from this table is
 * unreachable from the browser, which is what keeps edit mode to wording only:
 * ids, slugs, image paths, pixel dimensions and facet values are deliberately
 * missing. `optional: true` means the field may be absent from a record and may
 * be cleared again; a required field can be rewritten but never emptied.
 */
export const EDITABLE_CONTENT = {
  'content/artworks.json': {
    artworks: {
      keyField: 'id',
      fields: {
        titleEn: { type: 'text', maxLength: 200 },
        titleZh: { type: 'text', maxLength: 200 },
        altEn: { type: 'text', maxLength: 500 },
        altZh: { type: 'text', maxLength: 500 },
        dimensionsEn: { type: 'text', maxLength: 120, optional: true },
        dimensionsZh: { type: 'text', maxLength: 120, optional: true },
        year: { type: 'year', optional: true },
      },
    },
  },
  'content/gallery.json': {
    mediumPages: {
      keyField: 'slug',
      fields: {
        titleEn: { type: 'text', maxLength: 120 },
        titleZh: { type: 'text', maxLength: 120 },
        metaDescription: { type: 'text', maxLength: 300 },
      },
    },
    sectionPages: {
      keyField: 'slug',
      fields: {
        titleEn: { type: 'text', maxLength: 120 },
        titleZh: { type: 'text', maxLength: 120 },
        metaDescription: { type: 'text', maxLength: 300 },
        bodyEn: { type: 'text', maxLength: 500 },
        bodyZh: { type: 'text', maxLength: 500 },
      },
    },
  },
};

/**
 * Validate a submitted content patch and, unless `dryRun` is set, apply it to
 * the content files on disk.
 *
 * Input: `patch` is the document the browser edit mode submits --
 * `{ version: 1, edits: [{ file, collection, key, field, value }, ...] }` --
 * and is treated as entirely untrusted. `options.contentRoot` is the directory
 * that holds `content/`, normally the repository root; `options.dryRun` runs
 * every check and reports the same summary without writing, which is what the
 * browser uses to show the editor a review screen before they submit.
 *
 * Output: `{ ok, errors, changed, files, summary }`. `ok` is false when any
 * check failed, in which case `errors` lists every reason and nothing was
 * written. `changed` is false when the patch was valid but every edit already
 * matched what is on disk, which tells the caller not to open an empty pull
 * request. `files` lists the repo-relative files actually rewritten, and
 * `summary` carries one `{ file, collection, key, field, before, after }` entry
 * per real change, for the pull request body and the editor's review screen.
 *
 * Process: collect every validation failure first -- patch envelope, then each
 * edit's shape, whitelist membership, duplicate addressing and value rules --
 * then load each referenced content file and confirm it both round-trips
 * through JSON formatting byte for byte and contains the addressed record.
 * Only once nothing has failed are the edits applied in memory and the touched
 * files rewritten. The round-trip check is what guarantees the diff: a file
 * this module cannot reproduce exactly would be reformatted end to end by the
 * rewrite, burying a one-word edit in hundreds of lines of noise, so such a
 * file is refused rather than reformatted.
 *
 * Failure modes: returns `ok: false` with a populated `errors` array for every
 * rejected patch, including a missing or unreadable content file. It throws
 * only on a genuinely unexpected filesystem error.
 */
export function applyContentPatch(patch, options = {}) {
  const contentRoot = options.contentRoot ?? process.cwd();
  const dryRun = options.dryRun === true;
  const errors = [];
  const rejected = { ok: false, errors, changed: false, files: [], summary: [] };

  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    errors.push('patch must be an object');
    return rejected;
  }
  if (patch.version !== 1) {
    errors.push(`unsupported patch version ${JSON.stringify(patch.version ?? null)}; expected 1`);
    return rejected;
  }
  if (!Array.isArray(patch.edits) || patch.edits.length === 0) {
    errors.push('patch edits must be a non-empty array');
    return rejected;
  }
  if (patch.edits.length > MAX_EDITS_PER_PATCH) {
    errors.push(`patch edits must contain at most ${MAX_EDITS_PER_PATCH} entries, got ${patch.edits.length}`);
    return rejected;
  }

  const allowedEditProperties = ['file', 'collection', 'key', 'field', 'value'];
  const addressed = new Set();
  const accepted = [];

  for (let index = 0; index < patch.edits.length; index += 1) {
    const candidate = patch.edits[index];
    const at = `edit ${index}`;

    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      errors.push(`${at}: must be an object`);
      continue;
    }
    let shapeFailed = false;
    for (const property of Object.keys(candidate)) {
      if (!allowedEditProperties.includes(property)) {
        errors.push(`${at}: unknown property ${JSON.stringify(property)}`);
        shapeFailed = true;
      }
    }
    for (const property of allowedEditProperties) {
      if (!Object.prototype.hasOwnProperty.call(candidate, property)) {
        errors.push(`${at}: missing property ${JSON.stringify(property)}`);
        shapeFailed = true;
      }
    }
    if (shapeFailed) continue;

    const { file, collection, key, field, value } = candidate;
    if (typeof file !== 'string' || !Object.prototype.hasOwnProperty.call(EDITABLE_CONTENT, file)) {
      errors.push(`${at}: file ${JSON.stringify(file)} is not an editable content file`);
      continue;
    }
    const collections = EDITABLE_CONTENT[file];
    if (typeof collection !== 'string' || !Object.prototype.hasOwnProperty.call(collections, collection)) {
      errors.push(`${at}: collection ${JSON.stringify(collection)} is not editable in ${file}`);
      continue;
    }
    const spec = collections[collection];
    if (typeof field !== 'string' || !Object.prototype.hasOwnProperty.call(spec.fields, field)) {
      errors.push(`${at}: field ${JSON.stringify(field)} is not editable in ${file}/${collection}`);
      continue;
    }
    if (typeof key !== 'string' || key.trim() === '') {
      errors.push(`${at}: key must be a non-empty string`);
      continue;
    }
    const address = `${file}|${collection}|${key}|${field}`;
    if (addressed.has(address)) {
      errors.push(`${at}: duplicate edit for ${file}/${collection}/${key}/${field}`);
      continue;
    }
    addressed.add(address);

    const rule = spec.fields[field];
    if (rule.type === 'text') {
      if (value === null) {
        if (rule.optional !== true) {
          errors.push(`${at}: field ${field} cannot be cleared`);
          continue;
        }
        accepted.push({ file, collection, key, field, value: null, spec, rule });
        continue;
      }
      if (typeof value !== 'string') {
        errors.push(`${at}: value for ${field} must be a string, got ${typeof value}`);
        continue;
      }
      if (value.length > MAX_RAW_VALUE_LENGTH) {
        errors.push(
          `${at}: value for ${field} must be at most ${MAX_RAW_VALUE_LENGTH} characters before trimming, got ${value.length}`
        );
        continue;
      }
      const trimmed = value.trim();
      if (trimmed === '') {
        errors.push(`${at}: value for ${field} must not be empty`);
        continue;
      }
      if (trimmed.length > rule.maxLength) {
        errors.push(`${at}: value for ${field} must be at most ${rule.maxLength} characters, got ${trimmed.length}`);
        continue;
      }
      if (/[\r\n]/.test(trimmed)) {
        errors.push(`${at}: value for ${field} must be a single line`);
        continue;
      }
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
        errors.push(`${at}: value for ${field} must not contain control characters`);
        continue;
      }
      if (/[<>{}]/.test(trimmed)) {
        // Angle brackets: the build HTML-escapes every value, so markup here
        // would render as literal brackets rather than execute. Rejecting it
        // keeps that a defence in depth instead of the only defence.
        // Braces: the build substitutes {{TOKEN}} placeholders and then throws
        // on any that is left over, so a brace in editable wording is a
        // gate-valid patch that would take the whole site build down.
        errors.push(`${at}: value for ${field} must not contain the characters < > { or }`);
        continue;
      }
      accepted.push({ file, collection, key, field, value: trimmed, spec, rule });
      continue;
    }
    if (rule.type === 'year') {
      if (value === null) {
        accepted.push({ file, collection, key, field, value: null, spec, rule });
        continue;
      }
      if (!Number.isInteger(value) || value < 1000 || value > 9999) {
        errors.push(`${at}: value for ${field} must be a four-digit integer or null, got ${JSON.stringify(value)}`);
        continue;
      }
      accepted.push({ file, collection, key, field, value, spec, rule });
      continue;
    }
    errors.push(`${at}: field ${field} has unsupported rule type ${JSON.stringify(rule.type)}`);
  }

  const loaded = new Map();
  for (const entry of accepted) {
    if (!loaded.has(entry.file)) {
      const absolute = path.join(contentRoot, entry.file);
      let raw;
      try {
        raw = readFileSync(absolute, 'utf8');
      } catch (cause) {
        errors.push(`${entry.file}: cannot be read (${cause.code ?? cause.message})`);
        loaded.set(entry.file, null);
        continue;
      }
      let data;
      try {
        data = JSON.parse(raw);
      } catch (cause) {
        errors.push(`${entry.file}: is not valid JSON (${cause.message})`);
        loaded.set(entry.file, null);
        continue;
      }
      if (`${JSON.stringify(data, null, 4)}\n` !== raw) {
        errors.push(
          `${entry.file}: formatting does not round-trip, so applying an edit would reformat the whole file; ` +
            'normalise the file to 4-space JSON formatting before enabling edit mode on it'
        );
        loaded.set(entry.file, null);
        continue;
      }
      loaded.set(entry.file, data);
    }
    const data = loaded.get(entry.file);
    if (data === null) continue;
    const records = data[entry.collection];
    if (!Array.isArray(records)) {
      errors.push(`${entry.file}: ${entry.collection} is not an array`);
      continue;
    }
    const record = records.find((item) => item !== null && typeof item === 'object' && item[entry.spec.keyField] === entry.key);
    if (record === undefined) {
      errors.push(
        `${entry.file}/${entry.collection}: key ${JSON.stringify(entry.key)} does not match any record`
      );
      continue;
    }
    // A required field may be rewritten but never emptied: the gallery build
    // throws on a missing required field, which would take the whole site build
    // down rather than degrade a single card.
    if (entry.value === null && entry.rule.optional !== true) {
      errors.push(`${entry.file}/${entry.collection}/${entry.key}: field ${entry.field} cannot be cleared`);
      continue;
    }
    entry.record = record;
  }

  if (errors.length > 0) return rejected;

  const summary = [];
  const touched = new Set();
  for (const entry of accepted) {
    const before = Object.prototype.hasOwnProperty.call(entry.record, entry.field) ? entry.record[entry.field] : null;
    const after = entry.value;
    if (before === after) continue;
    if (after === null) {
      delete entry.record[entry.field];
    } else {
      entry.record[entry.field] = after;
    }
    summary.push({ file: entry.file, collection: entry.collection, key: entry.key, field: entry.field, before, after });
    touched.add(entry.file);
  }

  if (summary.length === 0) {
    return { ok: true, errors: [], changed: false, files: [], summary: [] };
  }

  const files = [...touched].sort();
  if (!dryRun) {
    for (const file of files) {
      writeFileSync(path.join(contentRoot, file), `${JSON.stringify(loaded.get(file), null, 4)}\n`);
    }
  }
  return { ok: true, errors: [], changed: true, files, summary };
}
