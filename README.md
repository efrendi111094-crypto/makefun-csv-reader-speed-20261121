# Fast CSV Reader — a faster drop-in for csv-reader 1.0.0

![Read broken CSV files faster](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)
![Rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/efrendi111094-crypto/makefun-csv-reader-speed-20261121/rank.svg)
![Reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/efrendi111094-crypto/makefun-csv-reader-speed-20261121/reward.svg)

An entry for [Read broken CSV files faster, 21 November 2026](https://make.fun/bounty/csv-reader-speed-01-run-20261121) — a dependency-free, stdlib-only drop-in replacement for make.fun's own csv-reader 1.0.0 that answers exactly as the original on every case, including broken CSVs, and does it in far less CPU time.

## What it does

`solve.js` exports `run(input)`, which reads one case's `{text, header}` exactly the way csv-reader 1.0.0 does and returns `{columns, rows, errors}`:

- A U+FEFF at the very start is dropped; a record ends at LF or CRLF, and an empty line is no record.
- Outside quotes a CR not followed by LF is dropped (`stray_cr`).
- A field opening with a quote runs to the next undoubled quote; `""` inside it is one quote, and each CRLF or lone CR inside it reads as LF. Whatever follows the closing quote up to the next comma or line break is appended as it stands (`quote_junk`). A quote that never closes is a literal character and the text after it is read again as unquoted (`unterminated_quote`).
- A quote inside an unquoted field is a literal character. Fields stay strings — never trimmed, never converted.
- `columns` is the first record when `header` is true, else `null`; rows are padded with empty strings (`short_row`) or cut (`long_row`) to the first record's width. Every error is `{code, line, row}`, in the order met, with the line the record starts on.

## Why it is faster

The reference builds every field one character at a time. This entry does not:

- **Whole-line fast path** — a record whose physical line holds no field opening with a quote and no stray CR is one slice plus `String.split(',')`. A quote anywhere else in the line is a literal character, so the split gives exactly the reference's fields.
- **Index-based quoted fields** — a quoted field is closed with `indexOf('"')` instead of a per-character scan, skipping doubled quotes in pairs. When the span between the quotes holds no newline, no CR and no doubled quote, the value is a single slice; only the rare span with line breaks or doubled quotes goes through a slow builder that normalises CRLF/lone CR to LF and counts lines.
- **Slice-based unquoted fields** — unquoted fields are taken out with one slice per field, with a small scanner only for the rare stray CR.

Correctness comes first: every edge case above is covered by the same policy as the reference, verified against the reference implementation on the practice set and on thousands of generated broken-CSV inputs.

## Run it

```sh
node main.ts
```

`main.ts` reads every case from `/input/cases.json`, answers each with `run`, and writes `/output/answers.json` (outside a container, `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR` stand in for `/input` and `/output`). Node 22 or later, no dependencies, no network.

## Files

- `solve.js` — the fast reader (`run`)
- `main.ts` — the harness driver
- `package.json` — `{"type": "module"}`

## Referral

Built for the make.fun bounty — if you enter too, my referral code is `tzrh51cg`.
