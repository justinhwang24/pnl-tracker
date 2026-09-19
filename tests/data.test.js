import test from "node:test";
import assert from "node:assert/strict";
import { parseCSV, loadKalshiCSV } from "../src/csv.js";
import { newestMonth, monthEntries } from "../src/pnl.js";
import { ymd, fmtMoney } from "../src/format.js";

test("CSV handles quoted commas, escaped quotes, multiline fields, and CRLF", () => {
  assert.deepEqual(parseCSV('name,note\r\n"a,b","say ""hi""\nagain"\r\n'), [
    ["name", "note"], ["a,b", 'say "hi"\nagain'],
  ]);
});

test("Kalshi imports aggregate by close date and skip unusable rows", () => {
  const csv = [
    "close_timestamp,realized_pnl_with_fees_dollars",
    "2026-09-19T10:00:00Z,12.5",
    "2026-09-19T11:00:00Z,-2.25",
    "2026-09-20T00:00:00Z,0",
    ",100",
    "2026-09-21T00:00:00Z,invalid",
  ].join("\n");
  assert.deepEqual(loadKalshiCSV(csv), { "2026-09-19": 10.25, "2026-09-20": 0 });
});

test("invalid CSV reports missing rows or required columns", () => {
  assert.throws(() => loadKalshiCSV(""), /no data rows/);
  assert.throws(() => loadKalshiCSV("a,b\n1,2"), /must contain/);
});

test("month selection uses the newest date and entries are chronological", () => {
  const data = { "2026-09-19": 2, "2025-09-15": 8, "2026-09-01": -1, "2026-06-13": 3 };
  const month = newestMonth(data);
  assert.equal(ymd(month), "2026-09-01");
  assert.deepEqual(monthEntries(data, month), [["2026-09-01", -1], ["2026-09-19", 2]]);
  assert.deepEqual(monthEntries(data, new Date(2026, 7, 1)), []);
  assert.ok(Number.isFinite(newestMonth({}).getTime()));
});

test("formatting preserves local calendar dates and currency signs", () => {
  assert.equal(ymd(new Date(2026, 0, 2)), "2026-01-02");
  assert.ok(fmtMoney(12.5).startsWith("+$"));
  assert.ok(fmtMoney(-12.5).startsWith("-$"));
  assert.ok(fmtMoney(0).startsWith("$"));
});
