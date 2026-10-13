let opening;
const database = () => opening ||= new Promise((resolve, reject) => {
  const request = indexedDB.open('bold-sheets-v1', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('files');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => {
    opening = null;
    reject(request.error);
  };
});
const key = (account, file) => String(account) + ':' + file;
async function access(mode, action) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('files', mode),
      store = transaction.objectStore('files');
    const request = action(store);
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onabort = transaction.onerror = () => reject(transaction.error || Error('No se pudo guardar la copia local.'));
  });
}
export const sheetsCache = {
  read: (account, file) => access('readonly', store => store.get(key(account, file))),
  write: (account, file, data) => access('readwrite', store => store.put(data, key(account, file))),
  remove: (account, file) => access('readwrite', store => store.delete(key(account, file))),
  async clear(account) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('files', 'readwrite'),
        store = transaction.objectStore('files');
      store.openCursor().onsuccess = event => {
        const cursor = event.target.result;
        if (!cursor) return;
        if (String(cursor.key).startsWith(String(account) + ':')) cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  }
};
