// Fast drop-in for csv-reader 1.0.0.
//
// Same answers as the reference on every input, same broken-row policy, but
// built for CPU time: fields are taken out of the text with slices and whole
// runs of plain fields with one split, instead of being assembled one
// character at a time. Three tricks carry almost all of the speed:
//
//   - A run of unquoted fields is one slice plus String split(','). A quote
//     anywhere but at a field's start is a literal character, so the split
//     gives exactly the reference's fields; a trailing CR before the line's
//     LF is the CRLF terminator and is stripped first. A record is read as
//     split runs of plain fields with its quoted fields parsed one by one
//     in between.
//   - A quoted field is closed by indexOf('"') instead of a per-character
//     scan. Doubled quotes ("") are skipped in pairs, exactly as the
//     reference reads them. When the span between the quotes holds no
//     newline, no CR and no doubled quote, the value is one slice;
//     otherwise a slow builder normalises CRLF and lone CR to LF, folds ""
//     to one quote and counts the lines the span crosses.
//   - Unquoted fields are taken out with one slice per field, with a small
//     scanner only for the rare stray CR.
//
// Everything rarer -- stray CRs, junk after a closing quote, a quote that
// never closes -- falls back to small scanners that follow the reference
// step for step, including the order and the {code, line, row} of every
// error. `line` counts every LF, CRLF and lone CR inside quotes; every
// error of a record carries the line that record starts on.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to
// the next. Dependency-free ES module; run(input) answers {columns, rows,
// errors} for one case's {text, header}.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header). Every error of the record carries these.
  let recordLine = 1;
  let recordRow = null;

  // How the field just read ended (set by the readers below), and how many
  // characters the last readUnquoted call kept (the quote_junk test).
  let fEnded = END;
  let fAdded = 0;

  // Reads unquoted characters onto `prefix` up to the next comma or line
  // break, and returns the field. A CR not followed by LF is dropped and
  // reported (stray_cr) and the field goes on. Sets fEnded, and fAdded to
  // the characters kept by this call (the quote_junk test uses it).
  function readUnquoted(prefix) {
    let value = prefix;
    let added = 0;
    let start = pos;
    let i = pos;
    for (;;) {
      while (i < len) {
        const c = text.charCodeAt(i);
        if (c === 44 || c === 10 || c === 13) break;
        i++;
      }
      if (i > start) {
        value += text.slice(start, i);
        added += i - start;
      }
      if (i >= len) {
        pos = len;
        fEnded = END;
        fAdded = added;
        return value;
      }
      const c = text.charCodeAt(i);
      if (c === 44) {
        pos = i + 1;
        fEnded = COMMA;
        fAdded = added;
        return value;
      }
      if (c === 10) {
        pos = i + 1;
        line += 1;
        fEnded = LINE_BREAK;
        fAdded = added;
        return value;
      }
      // A CR: a CRLF ends the field at a line break, a lone CR is dropped.
      if (text.charCodeAt(i + 1) === 10) {
        pos = i + 2;
        line += 1;
        fEnded = LINE_BREAK;
        fAdded = added;
        return value;
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      i += 1;
      start = i;
    }
  }

  // Builds a quoted field's value out of the span [start, end): "" folds to
  // one quote, each CRLF or lone CR becomes one LF, and `line` counts every
  // line break the span crosses. Every quote in the span is the first of a
  // doubled pair (the caller skipped pairs while finding the closing quote).
  function buildQuoted(start, end) {
    let value = '';
    let seg = start;
    let i = start;
    while (i < end) {
      const c = text.charCodeAt(i);
      if (c === 34) {
        value += text.slice(seg, i);
        value += '"';
        i += 2;
        seg = i;
        continue;
      }
      if (c === 13) {
        value += text.slice(seg, i);
        value += '\n';
        line += 1;
        i += text.charCodeAt(i + 1) === 10 ? 2 : 1;
        seg = i;
        continue;
      }
      if (c === 10) {
        value += text.slice(seg, i);
        value += '\n';
        line += 1;
        i += 1;
        seg = i;
        continue;
      }
      i++;
    }
    if (seg < end) value += text.slice(seg, end);
    return value;
  }

  // Reads a quoted field whose opening quote is at pos, and returns the
  // field. Sets fEnded like readUnquoted (added is reported through the
  // junk tail's own read, see below).
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let from = pos + 1;
    let hasDouble = false;
    let q = -1;
    for (;;) {
      q = text.indexOf('"', from);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        return readUnquoted('"');
      }
      if (text.charCodeAt(q + 1) === 34) {
        hasDouble = true;
        from = q + 2;
        continue;
      }
      break;
    }
    // The closing quote is at q. The next line break after the opening quote
    // is at most the end of this record away, so these two searches stay
    // inside the record.
    const nlAt = text.indexOf('\n', open + 1);
    const hasNL = nlAt !== -1 && nlAt < q;
    const crAt = text.indexOf('\r', open + 1);
    const hasCR = crAt !== -1 && crAt < q;
    const value = !hasDouble && !hasNL && !hasCR
      ? text.slice(open + 1, q)
      : buildQuoted(open + 1, q);
    pos = q + 1;
    if (pos >= len) {
      fEnded = END;
      return value;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fEnded = COMMA;
      return value;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fEnded = LINE_BREAK;
      return value;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fEnded = LINE_BREAK;
      return value;
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const junk = readUnquoted(value);
    if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    const fields = [];
    let lastQuoted = false;
    for (;;) {
      if (text.charCodeAt(pos) === 34) {
        lastQuoted = true;
        fields.push(readQuoted());
        if (fEnded !== COMMA) break;
        continue;
      }
      lastQuoted = false;
      // An unquoted field starts here. The rest of this physical line, when
      // it holds no field opening with a quote and no stray CR, is plain
      // fields in one split -- and the line break ends the record.
      const nl = text.indexOf('\n', pos);
      const lineEnd = nl === -1 ? len : nl;
      let rawEnd = lineEnd;
      if (nl !== -1 && rawEnd > pos && text.charCodeAt(rawEnd - 1) === 13) rawEnd -= 1;
      const raw = text.slice(pos, rawEnd);
      const qAt = raw.indexOf(',"');
      const crAt = raw.indexOf('\r');
      if (qAt === -1 && crAt === -1) {
        const parts = raw.split(',');
        for (let k = 0; k < parts.length; k++) fields.push(parts[k]);
        fEnded = nl === -1 ? END : LINE_BREAK;
        pos = nl === -1 ? len : nl + 1;
        if (fEnded === LINE_BREAK) line += 1;
        break;
      }
      if (crAt !== -1 && (qAt === -1 || crAt < qAt)) {
        // A stray CR stands before any quoted field: read one field the
        // slow way, which drops it and reports it.
        fields.push(readUnquoted(''));
        if (fEnded !== COMMA) break;
        continue;
      }
      // A quoted field opens ahead at raw index qAt + 1; the fields before
      // it are plain, so split them and loop on to the quoted field.
      const head = raw.slice(0, qAt).split(',');
      for (let k = 0; k < head.length; k++) fields.push(head[k]);
      pos += qAt + 1;
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
