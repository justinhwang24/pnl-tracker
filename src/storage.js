const guestKey = 'kalshi-pnl:guest:v1';

export function createGuestStore(storage) {
  return {
    async load() {
      const raw = storage.getItem(guestKey);
      if (!raw) return null;
      const record = JSON.parse(raw);
      if (typeof record.csv !== 'string' || typeof record.timeZone !== 'string' || typeof record.filename !== 'string') {
        throw new Error('Saved browser data is invalid. Contact support to reset it.');
      }
      return record;
    },
    async save(record) { storage.setItem(guestKey, JSON.stringify(record)); },
    async clear() { storage.removeItem(guestKey); },
  };
}

export function createAccountStore(client, userId) {
  return {
    async load() {
      const { data, error } = await client.from('pnl_uploads')
        .select('csv, filename, time_zone').eq('user_id', userId).maybeSingle();
      if (error) throw error;
      return data ? { csv: data.csv, filename: data.filename, timeZone: data.time_zone } : null;
    },
    async save(record) {
      const { error } = await client.from('pnl_uploads').upsert({
        user_id: userId, csv: record.csv, filename: record.filename,
        time_zone: record.timeZone, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (error) throw error;
    },
    async clear() {
      const { error } = await client.from('pnl_uploads').delete().eq('user_id', userId);
      if (error) throw error;
    },
  };
}
