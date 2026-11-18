// assets/js/edit-mode.js -- the browser half of admin edit mode.
//
// Loaded on demand by the edit-mode-bootstrap partial, never on an ordinary
// page view. What it does: finds every element the build marked with a
// data-edit-field address, lets the editor rewrite that text in place on the
// real page, collects the changes, shows them back as before/after, and
// downloads them as edit-patch.json. What it does not do: anything to the live
// site. It holds no credential, makes no network call, and writes nothing
// anybody else can see. The downloaded file goes to a reviewer who runs
// scripts/apply-patch.mjs, and that script's gate re-validates every edit.
//
// Input:  elements carrying data-edit-field="file|collection|key|field", the
//         same address string scripts/content-patch.mjs uses internally, and
//         window.GALLERY_EDIT_RULES, generated from the gate's whitelist.
//         The contract the build guarantees is that such an element's
//         textContent is exactly the raw value on disk.
// Output: a downloaded edit-patch.json of the shape
//         { version: 1, edits: [{ file, collection, key, field, value }] },
//         plus pending edits kept in sessionStorage so one patch can span
//         several gallery pages.
//
// Process: restore any pending edits for this page and reconcile them against
// what is actually on disk, mark the body so the stylesheet shows a pencil on
// every editable element, then on click make that one element contentEditable.
// On commit the new text is trimmed and checked against the generated limits;
// a value the gate would refuse is reported and the element is put back the way
// it was, so the page never displays text that could not be submitted. The
// review screen reads the pending list, which is kept byte-identical to what
// apply-patch.mjs --dry-run will report: an edit whose value matches disk is
// dropped rather than listed, exactly as the gate drops it from its summary.
//
// The client-side checks here are a courtesy for fast feedback and nothing
// more. They are deliberately a mirror of the gate rather than the gate
// itself, and the gate assumes nothing about them.

(function () {
  'use strict';

  var rules = window.GALLERY_EDIT_RULES;
  if (!rules) {
    console.error('edit mode: window.GALLERY_EDIT_RULES is missing; run "npm run build"');
    return;
  }

  var MODE_STORAGE_KEY = 'galleryEditMode';
  var PENDING_STORAGE_KEY = 'galleryEditPending';
  // Mirrors MAX_RAW_VALUE_LENGTH in scripts/content-patch.mjs, the ceiling the
  // gate applies to a raw value before it trims.
  var MAX_RAW_VALUE_LENGTH = 4096;

  // Bilingual chrome copy, kept as literal UTF-8 the way the rest of this
  // repo keeps site copy (see UNDATED_ZH in build.mjs and content/gallery.json).
  // The .lang-en / .lang-zh classes are what site.css already uses to show one
  // language at a time, so the overlay follows the page's language switcher
  // with no extra wiring.
  var COPY = {
    modeLabel: { en: 'Edit mode', zh: '编辑模式' },
    review: { en: 'Review changes', zh: '复核改动' },
    exit: { en: 'Exit edit mode', zh: '退出编辑模式' },
    reviewTitle: { en: 'Pending changes', zh: '待提交改动' },
    noChanges: { en: 'Nothing changed yet. Click any text with a pencil to edit it.', zh: '尚无改动。点击任何带铅笔标识的文字即可编辑。' },
    before: { en: 'Before', zh: '原值' },
    after: { en: 'After', zh: '新值' },
    discard: { en: 'Discard', zh: '撤销' },
    discardAll: { en: 'Discard all', zh: '全部撤销' },
    download: { en: 'Download edit-patch.json', zh: '下载 edit-patch.json' },
    close: { en: 'Close', zh: '关闭' },
    downloaded: {
      en: 'Downloaded edit-patch.json. Send it to a reviewer, who applies it with scripts/apply-patch.mjs.',
      zh: '已下载 edit-patch.json。请交给复核人，由其用 scripts/apply-patch.mjs 应用。',
    },
    editHint: { en: 'Press Enter to keep the change, Escape to cancel.', zh: '按 Enter 保留改动，按 Escape 取消。' },
  };

  // One pending edit per address, in the order the editor made them.
  var pending = [];
  try {
    var stored = window.sessionStorage.getItem(PENDING_STORAGE_KEY);
    var parsed = stored === null ? [] : JSON.parse(stored);
    if (Array.isArray(parsed)) {
      for (var p = 0; p < parsed.length; p += 1) {
        var candidate = parsed[p];
        if (
          candidate !== null &&
          typeof candidate === 'object' &&
          typeof candidate.file === 'string' &&
          typeof candidate.collection === 'string' &&
          typeof candidate.key === 'string' &&
          typeof candidate.field === 'string' &&
          typeof candidate.after === 'string'
        ) {
          pending.push({
            file: candidate.file,
            collection: candidate.collection,
            key: candidate.key,
            field: candidate.field,
            before: typeof candidate.before === 'string' ? candidate.before : '',
            after: candidate.after,
          });
        }
      }
    }
  } catch (error) {
    // Corrupt or blocked storage starts the editor from a clean slate rather
    // than failing the page. Losing unsubmitted edits is recoverable; a broken
    // gallery page is not.
    console.warn('edit mode: could not restore pending edits, starting empty', error);
    pending = [];
  }

  try {
    window.sessionStorage.setItem(MODE_STORAGE_KEY, 'on');
  } catch (error) {
    console.warn('edit mode: cannot persist the mode flag, it will not survive navigation', error);
  }

  document.body.classList.add('edit-mode-on');

  var editables = Array.prototype.slice.call(document.querySelectorAll('[data-edit-field]'));

  // The value on disk for every address rendered on this page. The build
  // guarantees textContent is that value, and this is read before any pending
  // edit is painted over it, so it stays the authoritative "before".
  var onDisk = {};
  for (var e = 0; e < editables.length; e += 1) {
    onDisk[editables[e].getAttribute('data-edit-field')] = editables[e].textContent;
  }

  // Reconcile what was restored against what is actually on disk now. A patch
  // may have been applied and the page rebuilt since these edits were made, so
  // disk wins: an edit that now matches disk is dropped, and an edit whose
  // recorded "before" has moved is corrected. Without this the review screen
  // could show a row that apply-patch.mjs --dry-run would not report, and the
  // two are supposed to agree exactly.
  var reconciled = [];
  for (var r = 0; r < pending.length; r += 1) {
    var entry = pending[r];
    var entryAddress = entry.file + '|' + entry.collection + '|' + entry.key + '|' + entry.field;
    var diskValue = onDisk[entryAddress];
    if (diskValue === undefined) {
      // Belongs to a page the editor is not on. Carry it unchanged.
      reconciled.push(entry);
      continue;
    }
    if (entry.after === diskValue) continue;
    entry.before = diskValue;
    reconciled.push(entry);
  }
  pending = reconciled;

  var toolbar = document.createElement('div');
  toolbar.className = 'edit-mode-toolbar';
  toolbar.setAttribute('role', 'region');
  toolbar.setAttribute('aria-label', 'Admin edit mode');
  toolbar.innerHTML =
    '<span class="edit-mode-badge">' +
    '<span class="lang-en">' + COPY.modeLabel.en + '</span><span class="lang-zh">' + COPY.modeLabel.zh + '</span>' +
    '</span>' +
    '<span class="edit-mode-status" role="status" aria-live="polite"></span>' +
    '<button type="button" class="edit-mode-button edit-mode-review">' +
    '<span class="lang-en">' + COPY.review.en + '</span><span class="lang-zh">' + COPY.review.zh + '</span>' +
    '<span class="edit-mode-count"></span>' +
    '</button>' +
    '<button type="button" class="edit-mode-button edit-mode-exit">' +
    '<span class="lang-en">' + COPY.exit.en + '</span><span class="lang-zh">' + COPY.exit.zh + '</span>' +
    '</button>';
  document.body.appendChild(toolbar);

  var statusArea = toolbar.querySelector('.edit-mode-status');
  var countArea = toolbar.querySelector('.edit-mode-count');

  var panel = document.createElement('div');
  panel.className = 'edit-mode-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', COPY.reviewTitle.en);
  panel.hidden = true;
  panel.innerHTML =
    '<div class="edit-mode-panel-inner">' +
    '<h2><span class="lang-en">' + COPY.reviewTitle.en + '</span><span class="lang-zh">' + COPY.reviewTitle.zh + '</span></h2>' +
    '<div class="edit-mode-review-list"></div>' +
    '<div class="edit-mode-panel-actions">' +
    '<button type="button" class="edit-mode-button edit-mode-download">' +
    '<span class="lang-en">' + COPY.download.en + '</span><span class="lang-zh">' + COPY.download.zh + '</span>' +
    '</button>' +
    '<button type="button" class="edit-mode-button edit-mode-discard-all">' +
    '<span class="lang-en">' + COPY.discardAll.en + '</span><span class="lang-zh">' + COPY.discardAll.zh + '</span>' +
    '</button>' +
    '<button type="button" class="edit-mode-button edit-mode-close">' +
    '<span class="lang-en">' + COPY.close.en + '</span><span class="lang-zh">' + COPY.close.zh + '</span>' +
    '</button>' +
    '</div>' +
    '</div>';
  document.body.appendChild(panel);

  var reviewList = panel.querySelector('.edit-mode-review-list');
  var downloadButton = panel.querySelector('.edit-mode-download');

  /**
   * Persist the pending edits and redraw everything that displays them.
   *
   * Input: nothing; it reads the module-level `pending` list. Output: nothing;
   * it writes sessionStorage and rewrites the toolbar count, the page text for
   * every address on this page, and the review list.
   *
   * Process: write the list to sessionStorage so it survives navigation to
   * another gallery page, then repaint. Repainting restores the on-disk value
   * for every address that is no longer pending, which is what makes Discard
   * put the real page text back. The review rows are rebuilt from scratch each
   * time rather than patched, because the list is short and a rebuild cannot
   * drift from the data the way incremental updates can.
   *
   * Failure modes: a browser that blocks sessionStorage logs a warning and
   * keeps working for the current page only.
   */
  function refresh() {
    try {
      window.sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(pending));
    } catch (error) {
      console.warn('edit mode: cannot persist pending edits, they will not survive navigation', error);
    }

    var byAddress = {};
    for (var i = 0; i < pending.length; i += 1) {
      byAddress[pending[i].file + '|' + pending[i].collection + '|' + pending[i].key + '|' + pending[i].field] =
        pending[i];
    }

    for (var j = 0; j < editables.length; j += 1) {
      var element = editables[j];
      var address = element.getAttribute('data-edit-field');
      var match = byAddress[address];
      if (element.classList.contains('edit-mode-editing')) continue;
      if (match === undefined) {
        element.textContent = onDisk[address];
        element.classList.remove('edit-mode-changed');
      } else {
        element.textContent = match.after;
        element.classList.add('edit-mode-changed');
      }
    }

    countArea.textContent = pending.length === 0 ? '' : ' (' + pending.length + ')';
    downloadButton.disabled = pending.length === 0;

    reviewList.textContent = '';
    if (pending.length === 0) {
      var empty = document.createElement('p');
      empty.className = 'edit-mode-empty';
      empty.innerHTML =
        '<span class="lang-en">' + COPY.noChanges.en + '</span><span class="lang-zh">' + COPY.noChanges.zh + '</span>';
      reviewList.appendChild(empty);
      return;
    }
    for (var k = 0; k < pending.length; k += 1) {
      var row = document.createElement('div');
      row.className = 'edit-mode-review-row';
      var rowAddress =
        pending[k].file + '|' + pending[k].collection + '|' + pending[k].key + '|' + pending[k].field;
      row.setAttribute('data-edit-review-for', rowAddress);

      var where = document.createElement('p');
      where.className = 'edit-mode-review-where';
      where.textContent = pending[k].collection + ' / ' + pending[k].key + ' / ' + pending[k].field;
      row.appendChild(where);

      var beforeLine = document.createElement('p');
      beforeLine.className = 'edit-mode-review-before';
      var beforeLabel = document.createElement('span');
      beforeLabel.className = 'edit-mode-review-label';
      beforeLabel.innerHTML =
        '<span class="lang-en">' + COPY.before.en + '</span><span class="lang-zh">' + COPY.before.zh + '</span>';
      beforeLine.appendChild(beforeLabel);
      var beforeValue = document.createElement('span');
      beforeValue.className = 'edit-mode-review-value';
      beforeValue.textContent = pending[k].before;
      beforeLine.appendChild(beforeValue);
      row.appendChild(beforeLine);

      var afterLine = document.createElement('p');
      afterLine.className = 'edit-mode-review-after';
      var afterLabel = document.createElement('span');
      afterLabel.className = 'edit-mode-review-label';
      afterLabel.innerHTML =
        '<span class="lang-en">' + COPY.after.en + '</span><span class="lang-zh">' + COPY.after.zh + '</span>';
      afterLine.appendChild(afterLabel);
      var afterValue = document.createElement('span');
      afterValue.className = 'edit-mode-review-value';
      afterValue.textContent = pending[k].after;
      afterLine.appendChild(afterValue);
      row.appendChild(afterLine);

      var discardButton = document.createElement('button');
      discardButton.type = 'button';
      discardButton.className = 'edit-mode-button edit-mode-discard';
      discardButton.setAttribute('data-edit-discard', rowAddress);
      discardButton.innerHTML =
        '<span class="lang-en">' + COPY.discard.en + '</span><span class="lang-zh">' + COPY.discard.zh + '</span>';
      row.appendChild(discardButton);

      reviewList.appendChild(row);
    }
  }

  for (var w = 0; w < editables.length; w += 1) {
    var editable = editables[w];
    var parts = editable.getAttribute('data-edit-field').split('|');
    var spec = rules[parts[0]] && rules[parts[0]][parts[1]];
    var rule = spec && spec.fields[parts[3]];
    if (!rule || rule.type !== 'text') {
      // The build already refuses to emit an address the gate would reject, so
      // reaching here means the page and the generated rules are out of step.
      // Leaving the element alone is the safe answer: no pencil, no edit.
      console.error('edit mode: no text rule for ' + editable.getAttribute('data-edit-field') + ', skipping');
      editable.removeAttribute('data-edit-field');
      continue;
    }

    editable.setAttribute('tabindex', '0');
    editable.setAttribute('role', 'button');
    editable.setAttribute('title', COPY.editHint.en);

    editable.addEventListener('click', function (event) {
      if (this.classList.contains('edit-mode-editing')) return;
      // Several editable elements sit inside a link, so the click that starts
      // an edit must not also follow the href.
      event.preventDefault();
      event.stopPropagation();
      this.classList.add('edit-mode-editing');
      this.setAttribute('contenteditable', 'plaintext-only');
      if (!this.isContentEditable) {
        // Firefox before 136 has no plaintext-only, and it rejects the value
        // rather than degrading. Falling back to true is fine because every
        // commit reads textContent and rejects the newlines and control
        // characters a rich paste would bring in.
        this.setAttribute('contenteditable', 'true');
      }
      this.focus();
      statusArea.textContent = '';
      statusArea.classList.remove('edit-mode-status-problem');
      // Selecting the existing text means the editor can type over it, which
      // is what they want far more often than appending to it. Guarded because
      // selection support is the one part of this that a host may not provide.
      try {
        var range = document.createRange();
        range.selectNodeContents(this);
        var selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
      } catch (error) {
        // No selection is a cosmetic loss, so it must not stop the edit.
      }
    });

    editable.addEventListener('keydown', function (event) {
      if (!this.classList.contains('edit-mode-editing')) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.click();
        }
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        this.blur();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.setAttribute('data-edit-cancelled', 'yes');
        this.blur();
      }
    });

    editable.addEventListener('blur', function () {
      if (!this.classList.contains('edit-mode-editing')) return;
      this.classList.remove('edit-mode-editing');
      this.removeAttribute('contenteditable');

      var address = this.getAttribute('data-edit-field');
      var addressParts = address.split('|');
      var fieldRule = rules[addressParts[0]][addressParts[1]].fields[addressParts[3]];
      var original = onDisk[address];

      if (this.getAttribute('data-edit-cancelled') === 'yes') {
        this.removeAttribute('data-edit-cancelled');
        refresh();
        return;
      }

      // Mirrors the text rules in scripts/content-patch.mjs, in the same order
      // and with the same thresholds, so a value this accepts is a value the
      // gate accepts. The gate re-runs all of it either way.
      var raw = this.textContent;
      var problem = '';
      if (raw.length > MAX_RAW_VALUE_LENGTH) {
        problem =
          'Too long: at most ' + MAX_RAW_VALUE_LENGTH + ' characters. / 过长：最多 ' + MAX_RAW_VALUE_LENGTH + ' 个字符。';
      }
      var value = raw.trim();
      if (problem === '' && value === '') {
        problem = 'This text cannot be empty. / 此文字不能为空。';
      }
      if (problem === '' && value.length > fieldRule.maxLength) {
        problem =
          'Too long: at most ' + fieldRule.maxLength + ' characters, got ' + value.length +
          '. / 过长：最多 ' + fieldRule.maxLength + ' 个字符，当前 ' + value.length + ' 个。';
      }
      if (problem === '' && /[\r\n]/.test(value)) {
        problem = 'This text must stay on one line. / 此文字必须保持单行。';
      }
      if (problem === '' && /[\u0000-\u001f\u007f]/.test(value)) {
        problem = 'This text cannot contain control characters. / 此文字不能包含控制字符。';
      }
      if (problem === '' && /[<>{}]/.test(value)) {
        problem = 'This text cannot contain < > { or }. / 此文字不能包含 < > { 或 } 。';
      }

      if (problem !== '') {
        statusArea.textContent = problem;
        statusArea.classList.add('edit-mode-status-problem');
        refresh();
        return;
      }

      statusArea.textContent = '';
      statusArea.classList.remove('edit-mode-status-problem');

      var next = [];
      for (var n = 0; n < pending.length; n += 1) {
        var existing = pending[n];
        var existingAddress =
          existing.file + '|' + existing.collection + '|' + existing.key + '|' + existing.field;
        if (existingAddress !== address) next.push(existing);
      }
      // A value equal to what is on disk is not a change. Dropping it here is
      // what keeps the review screen identical to the gate's own summary,
      // which skips any edit whose before and after match.
      if (value !== original) {
        next.push({
          file: addressParts[0],
          collection: addressParts[1],
          key: addressParts[2],
          field: addressParts[3],
          before: original,
          after: value,
        });
      }
      pending = next;
      refresh();
    });
  }

  toolbar.querySelector('.edit-mode-review').addEventListener('click', function () {
    panel.hidden = false;
    panel.querySelector('.edit-mode-close').focus();
  });

  toolbar.querySelector('.edit-mode-exit').addEventListener('click', function () {
    try {
      window.sessionStorage.removeItem(MODE_STORAGE_KEY);
    } catch (error) {
      console.warn('edit mode: cannot clear the mode flag', error);
    }
    // Pending edits are left in storage on purpose. Leaving edit mode by
    // accident should not throw away unsubmitted work; Discard all is the
    // deliberate way to drop it.
    var url = new URL(window.location.href);
    url.searchParams.delete('edit');
    window.location.href = url.toString();
  });

  panel.querySelector('.edit-mode-close').addEventListener('click', function () {
    panel.hidden = true;
  });

  panel.querySelector('.edit-mode-discard-all').addEventListener('click', function () {
    pending = [];
    refresh();
  });

  reviewList.addEventListener('click', function (event) {
    var button = event.target.closest('[data-edit-discard]');
    if (!button) return;
    var target = button.getAttribute('data-edit-discard');
    var kept = [];
    for (var d = 0; d < pending.length; d += 1) {
      var item = pending[d];
      if (item.file + '|' + item.collection + '|' + item.key + '|' + item.field !== target) kept.push(item);
    }
    pending = kept;
    refresh();
  });

  downloadButton.addEventListener('click', function () {
    if (pending.length === 0) return;
    var edits = [];
    for (var d = 0; d < pending.length; d += 1) {
      edits.push({
        file: pending[d].file,
        collection: pending[d].collection,
        key: pending[d].key,
        field: pending[d].field,
        value: pending[d].after,
      });
    }
    var blob = new Blob([JSON.stringify({ version: 1, edits: edits }, null, 2) + '\n'], {
      type: 'application/json',
    });
    var href = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = href;
    link.download = 'edit-patch.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(href);
    statusArea.textContent = COPY.downloaded.en;
    statusArea.classList.remove('edit-mode-status-problem');
  });

  refresh();
})();
