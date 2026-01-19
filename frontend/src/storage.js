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
    const request = indexedDB.open(DB_NAME, 2);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      // Clear all stores on schema upgrade to handle migration
      const storeNames = Array.from(database.objectStoreNames);
      storeNames.forEach(storeName => {
        if (database.objectStoreNames.contains(storeName)) {
          database.deleteObjectStore(storeName);
        }
      });

      // Create fresh stores
      database.createObjectStore(ENTRIES_STORE, { keyPath: 'hash' });
      database.createObjectStore(MERKLE_TREE_STORE, { keyPath: 'hash' });
      database.createObjectStore(INVERTED_INDEX_STORE, { keyPath: 'word' });
    };
  });
}

// Hash an entry to get content-addressed storage key
export async function hashEntry(entry) {
  const content = JSON.stringify(entry);
  return await sha256(content);
}

// Save entry to content-addressed storage
export async function saveEntry(entryData, parentHash = null) {
  if (!db) await initDB();

  const hash = await hashEntry(entryData);
  const timestamp = new Date().toISOString();

  // Determine root hash: if editing, use parent's root; otherwise this is a new root
  let rootHash = hash;
  let isNewEntry = true;

  if (parentHash) {
    isNewEntry = false;
    // Get the parent's merkle entry to find the root
    const parentMerkle = await getMerkleEntryByHash(parentHash);
    rootHash = parentMerkle?.rootHash || parentHash;
  }

  // If no parent hash provided, get the last entry (for new entries)
  if (!parentHash) {
    const lastMerkleEntry = await getLastMerkleEntry();
    parentHash = lastMerkleEntry ? lastMerkleEntry.hash : null;
  }

  // Save to entries store
  const entry = {
    hash,
    content: entryData,
    timestamp,
    rootHash,
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
      rootHash,
    };
    transaction.objectStore(MERKLE_TREE_STORE).put(merkleEntry);

    // Update inverted index with root hash for deduplication
    updateInvertedIndex(entryData, hash, rootHash, transaction);

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

// Get merkle entry by hash
async function getMerkleEntryByHash(hash) {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([MERKLE_TREE_STORE], 'readonly');
    const request = transaction.objectStore(MERKLE_TREE_STORE).get(hash);

    request.onsuccess = () => resolve(request.result);
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

// Update inverted index - properly handle async operations within transaction
function updateInvertedIndex(entryData, entryHash, rootHash, transaction) {
  const words = tokenize(entryData.title + ' ' + entryData.description);
  const uniqueWords = [...new Set(words)];
  const objectStore = transaction.objectStore(INVERTED_INDEX_STORE);

  uniqueWords.forEach((word) => {
    const getRequest = objectStore.get(word);

    getRequest.onsuccess = (event) => {
      const existing = event.target.result;

      // Create or update the inverted index entry
      // Handle both old format (entryHashes) and new format (rootHashes)
      const invertedIndexEntry = existing ? existing : { word, rootHashes: [] };

      // Migrate old format to new format if needed
      if (invertedIndexEntry.entryHashes && !invertedIndexEntry.rootHashes) {
        invertedIndexEntry.rootHashes = invertedIndexEntry.entryHashes;
        delete invertedIndexEntry.entryHashes;
      }

      // Ensure rootHashes array exists
      if (!invertedIndexEntry.rootHashes) {
        invertedIndexEntry.rootHashes = [];
      }

      // Add root hash if not already present
      if (!invertedIndexEntry.rootHashes.includes(rootHash)) {
        invertedIndexEntry.rootHashes.push(rootHash);
      }

      // Put back into store
      objectStore.put(invertedIndexEntry);
    };

    getRequest.onerror = () => {
      console.error('Error getting inverted index entry for word:', word);
    };
  });
}

// Search entries using inverted index
export async function searchEntries(query) {
  if (!db) await initDB();

  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([INVERTED_INDEX_STORE, ENTRIES_STORE, MERKLE_TREE_STORE], 'readonly');
    const rootHashes = new Set();

    let completedRequests = 0;

    tokens.forEach((token) => {
      const request = transaction.objectStore(INVERTED_INDEX_STORE).get(token);

      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          result.rootHashes.forEach((hash) => rootHashes.add(hash));
        }
        completedRequests++;

        if (completedRequests === tokens.length) {
          // For each root hash, find the latest version
          const merkleStore = transaction.objectStore(MERKLE_TREE_STORE);
          const allMerkleRequest = merkleStore.getAll();

          allMerkleRequest.onsuccess = () => {
            const allMerkleEntries = allMerkleRequest.result;

            // Map root hash to latest version hash
            const latestVersions = {};
            allMerkleEntries.forEach((entry) => {
              const root = entry.rootHash;
              if (rootHashes.has(root)) {
                if (!latestVersions[root] ||
                    new Date(entry.timestamp) > new Date(allMerkleEntries.find(e => e.hash === latestVersions[root])?.timestamp)) {
                  latestVersions[root] = entry.hash;
                }
              }
            });

            // Fetch full entries for latest versions only
            const latestHashes = Object.values(latestVersions);
            const entryPromises = latestHashes.map((hash) =>
              getEntryByHash(hash)
            );

            Promise.all(entryPromises).then((entries) => {
              // Sort by timestamp descending (most recent first)
              const sorted = entries.filter(e => e !== undefined)
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
              resolve(sorted);
            });
          };

          allMerkleRequest.onerror = () => reject(allMerkleRequest.error);
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
