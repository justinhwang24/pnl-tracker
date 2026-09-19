import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuestStore, createAccountStore } from '../src/storage.js';

const record = { csv: 'test CSV text', filename: 'upload.csv', timeZone: 'UTC' };
test('guest uploads survive new store instances and can be cleared', async () => {
  const data = new Map();
  const storage = { getItem: k => data.get(k), setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
  await createGuestStore(storage).save(record);
  assert.deepEqual(await createGuestStore(storage).load(), record);
  await createGuestStore(storage).clear();
  assert.equal(await createGuestStore(storage).load(), null);
});

test('storage failures are propagated rather than reported as saved', async () => {
  const store = createGuestStore({ setItem() { throw new Error('Quota exceeded'); } });
  await assert.rejects(store.save(record), /Quota/);
});

test('account persistence addresses only the current user and replaces the last CSV', async () => {
  const rows = new Map();
  const client = { from(table) {
    assert.equal(table, 'pnl_uploads');
    return {
      select() { return { eq(column, id) {
        assert.equal(column, 'user_id');
        return { async maybeSingle() { return { data: rows.get(id) || null, error: null }; } };
      } }; },
      async upsert(row) { rows.set(row.user_id, row); return { error: null }; },
      delete() { return { async eq(column, id) { assert.equal(column, 'user_id'); rows.delete(id); return { error: null }; } }; },
    };
  } };
  const a = createAccountStore(client, 'user-a'), b = createAccountStore(client, 'user-b');
  await a.save(record);
  assert.equal(await b.load(), null);
  const replacement = { ...record, csv: 'replacement' };
  await a.save(replacement);
  assert.equal(rows.size, 1);
  assert.deepEqual(await a.load(), replacement);
  await b.save(record);
  await a.clear();
  assert.equal(await a.load(), null);
  assert.deepEqual(await b.load(), record);
});

test('account API errors reach the caller', async () => {
  const store = createAccountStore({ from() { return { async upsert() { return { error: new Error('Access denied') }; } }; } }, 'user');
  await assert.rejects(store.save(record), /Access denied/);
});
