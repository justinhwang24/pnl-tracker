// IndexedDB can persist a non-extractable CryptoKey without storing its PEM.
async function connectionStore(userId, mode, value) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('closebook-connections', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('kalshi');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('kalshi', mode === 'get' ? 'readonly' : 'readwrite');
      const store = tx.objectStore('kalshi');
      const request = mode === 'get' ? store.get(userId) : mode === 'delete' ? store.delete(userId) : store.put(value, userId);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Could not save Kalshi connection.'));
    });
  } finally { db.close(); }
}
export const loadConnection = userId => connectionStore(userId, 'get');
export const saveConnection = (userId, keyId, key) => connectionStore(userId, 'put', { keyId, key });
export const deleteConnection = userId => connectionStore(userId, 'delete');
