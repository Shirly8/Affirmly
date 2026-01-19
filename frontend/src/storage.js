// Storage module: IndexedDB, hashing, and merkle tree management

import { sha256 } from './crypto.js';

const DB_NAME = 'affirmly';
const ENTRIES_STORE = 'entries';
const MERKLE_TREE_STORE = 'merkleTree';
const INVERTED_INDEX_STORE = 'invertedIndex';

let db = null;

// Initialize IndexedDB
export async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      // Create stores if they don't exist
      if (!database.objectStoreNames.contains(ENTRIES_STORE)) {
        database.createObjectStore(ENTRIES_STORE, { keyPath: 'hash' });
      }
      if (!database.objectStoreNames.contains(MERKLE_TREE_STORE)) {
        database.createObjectStore(MERKLE_TREE_STORE, { keyPath: 'hash' });
      }
      if (!database.objectStoreNames.contains(INVERTED_INDEX_STORE)) {
        database.createObjectStore(INVERTED_INDEX_STORE, { keyPath: 'word' });
      }
    };
  });
}

// Hash an entry to get content-addressed storage key
export async function hashEntry(entry) {
  const content = JSON.stringify(entry);
  return await sha256(content);
}

// Save entry to content-addressed storage
export async function saveEntry(entryData) {
  if (!db) await initDB();

  const hash = await hashEntry(entryData);
  const timestamp = new Date().toISOString();

  // Get parent hash (previous entry)
  const lastMerkleEntry = await getLastMerkleEntry();
  const parentHash = lastMerkleEntry ? lastMerkleEntry.hash : null;

  // Save to entries store
  const entry = {
    hash,
    content: entryData,
    timestamp,
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([ENTRIES_STORE, MERKLE_TREE_STORE, INVERTED_INDEX_STORE], 'readwrite');

    // Save entry
    transaction.objectStore(ENTRIES_STORE).put(entry);

    // Update merkle tree
    const merkleEntry = {
      hash,
      parentHash,
      timestamp,
      action: parentHash ? 'edited' : 'created',
    };
    transaction.objectStore(MERKLE_TREE_STORE).put(merkleEntry);

    // Update inverted index
    updateInvertedIndex(entryData, hash, transaction);

    transaction.oncomplete = () => {
      resolve({ hash, timestamp, merkleEntry });
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

// Get entry by hash
export async function getEntryByHash(hash) {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([ENTRIES_STORE], 'readonly');
    const request = transaction.objectStore(ENTRIES_STORE).get(hash);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Get all entries
export async function getAllEntries() {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([ENTRIES_STORE], 'readonly');
    const request = transaction.objectStore(ENTRIES_STORE).getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Get merkle tree (version history)
export async function getMerkleTree() {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([MERKLE_TREE_STORE], 'readonly');
    const request = transaction.objectStore(MERKLE_TREE_STORE).getAll();

    request.onsuccess = () => {
      const entries = request.result;
      // Sort by timestamp to maintain order
      entries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      resolve(entries);
    };
    request.onerror = () => reject(request.error);
  });
}

// Get last merkle entry (for building chain)
async function getLastMerkleEntry() {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([MERKLE_TREE_STORE], 'readonly');
    const request = transaction.objectStore(MERKLE_TREE_STORE).getAll();

    request.onsuccess = () => {
      const entries = request.result;
      if (entries.length === 0) {
        resolve(null);
      } else {
        // Return most recent entry
        entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        resolve(entries[0]);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

// Tokenize text for search
function tokenize(text) {
  return text
    .toLowerCase()
    .match(/\b\w+\b/g) || [];
}

// Update inverted index
function updateInvertedIndex(entryData, entryHash, transaction) {
  const words = tokenize(entryData.title + ' ' + entryData.description);
  const uniqueWords = [...new Set(words)];

  uniqueWords.forEach((word) => {
    const objectStore = transaction.objectStore(INVERTED_INDEX_STORE);
    const getRequest = objectStore.get(word);

    getRequest.onsuccess = () => {
      const existing = getRequest.result || { word, entryHashes: [] };

      // Add hash if not already present
      if (!existing.entryHashes.includes(entryHash)) {
        existing.entryHashes.push(entryHash);
      }

      objectStore.put(existing);
    };
  });
}

// Search entries using inverted index
export async function searchEntries(query) {
  if (!db) await initDB();

  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([INVERTED_INDEX_STORE, ENTRIES_STORE], 'readonly');
    const results = new Set();

    let completedRequests = 0;

    tokens.forEach((token) => {
      const request = transaction.objectStore(INVERTED_INDEX_STORE).get(token);

      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          result.entryHashes.forEach((hash) => results.add(hash));
        }
        completedRequests++;

        if (completedRequests === tokens.length) {
          // Fetch full entries for results
          const entryPromises = Array.from(results).map((hash) =>
            getEntryByHash(hash)
          );

          Promise.all(entryPromises).then((entries) => {
            resolve(entries.filter(e => e !== undefined));
          });
        }
      };

      request.onerror = () => reject(request.error);
    });

    if (tokens.length === 0) {
      resolve([]);
    }
  });
}

// Delete entry
export async function deleteEntry(hash) {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([ENTRIES_STORE, MERKLE_TREE_STORE], 'readwrite');

    transaction.objectStore(ENTRIES_STORE).delete(hash);
    transaction.objectStore(MERKLE_TREE_STORE).delete(hash);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

// Clear all data
export async function clearAllData() {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      [ENTRIES_STORE, MERKLE_TREE_STORE, INVERTED_INDEX_STORE],
      'readwrite'
    );

    transaction.objectStore(ENTRIES_STORE).clear();
    transaction.objectStore(MERKLE_TREE_STORE).clear();
    transaction.objectStore(INVERTED_INDEX_STORE).clear();

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}
