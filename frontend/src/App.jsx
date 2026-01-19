import React, { useState, useEffect } from 'react';
import viteLogo from './assets/images/3.png'
import affirmlyIcon from './assets/icon/2.svg'

import './App.css'
import { initDB, saveEntry as saveToStorage, searchEntries, getMerkleTree, getEntryByHash, getAllEntries } from './storage.js';

function App() {
  const [affirmations, setAffirmations] = useState([]) // Array
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [loading, setLoading] = useState(false);
  const [heartClicked, setHeartClicked] = useState({});
  const [popup, showPopup] = useState(false)
  const [popupMessage, showMessage] = useState("")
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [showSearch, setShowSearch] = useState(false);
  const [viewingEntry, setViewingEntry] = useState(null);
  const [entryHistory, setEntryHistory] = useState([]);
  const [editingEntryHash, setEditingEntryHash] = useState(null);  // Track which entry we're editing
  const [currentVersion, setCurrentVersion] = useState(null);  // Track version number and root hash

  // Clear database function for debugging
  const clearDatabase = async () => {
    try {
      const request = indexedDB.deleteDatabase('affirmly');
      request.onsuccess = () => {
        console.log('Database cleared');
        window.location.reload();
      };
      request.onerror = () => {
        console.error('Error clearing database');
      };
    } catch (error) {
      console.error('Error clearing database:', error);
    }
  };

  // Debug function to manually check entry loading
  const debugCheckEntry = async (hash) => {
    console.log('=== MANUAL DEBUG: Checking entry ===');
    try {
      await initDB();
      const entry = await getEntryByHash(hash);
      console.log('Entry retrieved:', entry);
      if (entry) {
        console.log('✓ Entry found!');
        console.log('- Hash:', entry.hash);
        console.log('- Root Hash:', entry.rootHash);
        console.log('- Title:', entry.content.title);
        console.log('- Affirmations count:', entry.content.affirmations.length);
      } else {
        console.log('✗ Entry NOT found in database');
      }
    } catch (err) {
      console.error('✗ Error checking entry:', err);
    }
  };

  // Make it globally accessible for debugging
  if (typeof window !== 'undefined') {
    window.clearAffirmlyDB = clearDatabase;
    window.debugCheckEntry = debugCheckEntry;
  }

  // Initialize database and handle URL routing
  useEffect(() => {
    const init = async () => {
      try {
        console.log('=== INITIALIZATION STARTED ===');
        console.log('Current URL hash:', window.location.hash);
        await initDB();

        const demoV1 = {
          title: "I'm 24 and I constantly feel like I'm a failure",
          description: "I see all my friends getting married, having kids, getting senior roles, advancing in life and I just seem to not be getting anywhere in life. I can't help compare to them because I feel like I'm nowhere near where i want to be in life and I feel that time is running",
          affirmations: [
            "Comparison is the thief of joy. I embrace my journey and celebrate the successes of others without diminishing my own.",
            "Remember, life is not a race, and success is not a linear path. Your worth and value are inherent, regardless of external achievements.",
            "I am exactly where I need to be at this moment, and I trust the timing of my life.",
            "My journey is unique and valuable, unfolding at its own perfect pace.",
          ],
          mood: "neutral",
          timestamp: "2025-01-19T10:00:00.000Z"
        };

        const demoV2 = {
          title: "I'm 24 and I constantly feel like I'm a failure",
          description: "I see all my friends getting married, having kids, getting senior roles, advancing in life and I just seem to not be getting anywhere in life. I can't help compare to them because I feel like I'm nowhere near where i want to be in life and I feel that time is running",
          affirmations: [
            "I am building a life that is authentically mine, not a copy of someone else's.",
            "My past does not define my future. Today is a new opportunity to grow.",
            "I trust in my resilience and my ability to create the life I desire.",
            "Success comes in many forms, and I am already experiencing it in ways I haven't noticed.",
          ],
          mood: "neutral",
          timestamp: "2025-01-19T11:00:00.000Z"
        };

        // Always ensure demo entries exist
        let v1Result;
        try {
          v1Result = await saveToStorage(demoV1);
          console.log('✓ V1 created with hash:', v1Result.hash);

          await saveToStorage(demoV2, v1Result.hash);
          console.log('✓ V2 created with parent hash:', v1Result.hash);
          console.log('✓ Demo entries created with Merkle chain');
        } catch (demoErr) {
          console.error('✗ Error creating demo entries:', demoErr);
          return;
        }

        // Check if there's an entry hash in the URL
        const hash = window.location.hash;
        console.log('Checking URL hash:', hash);
        const hasEntryHash = hash.startsWith('#/entry/');
        console.log('Has entry hash:', hasEntryHash);

        if (hasEntryHash) {
          // Load entry from URL - but don't call viewEntryDetails to avoid hash loop
          const entryHash = hash.substring('#/entry/'.length);
          console.log('Attempting to load entry from URL with hash:', entryHash);
          try {
            const entry = await getEntryByHash(entryHash);
            console.log('✓ Query result:', entry);
            if (entry) {
              console.log('✓ Entry found in database');
              // Load entry data directly into form without calling viewEntryDetails
              const entryWithRoot = {
                ...entry,
                rootHash: entry.rootHash || entry.hash
              };
              console.log('✓ Loading entry data into form');
              setViewingEntry(entryWithRoot);
              setShowSearch(false);
              setEditingEntryHash(entry.hash);

              // Load entry data into form
              setTitle(entry.content.title);
              setDescription(entry.content.description);
              setAffirmations(entry.content.affirmations);
              setHeartClicked(entry.content.affirmations.reduce((acc, _, idx) => {
                acc[idx] = true;
                return acc;
              }, {}));

              // Load history
              const history = await getMerkleTree();
              setEntryHistory(history);
              const rootHash = entry.rootHash || entry.hash;
              const versionsOfThisEntry = history.filter(h => h.rootHash === rootHash);
              const versionNum = versionsOfThisEntry.length;
              console.log('✓ Setting current version:', { versionNum, rootHash });
              setCurrentVersion({ versionNum, rootHash });
              console.log('✓ Entry loaded successfully');
            } else {
              console.warn('✗ Entry not found for hash:', entryHash);
              console.log('Falling back to demo');
              // Fallback to demo if entry not found
              setTitle(demoV1.title);
              setDescription(demoV1.description);
              setAffirmations(demoV1.affirmations);
              setHeartClicked(demoV1.affirmations.reduce((acc, _, idx) => {
                acc[idx] = true;
                return acc;
              }, {}));
              setViewingEntry({
                hash: v1Result.hash,
                rootHash: v1Result.hash,
                content: demoV1,
                timestamp: demoV1.timestamp
              });
              const history = await getMerkleTree();
              setEntryHistory(history);
              const versionsOfThisEntry = history.filter(h => h.rootHash === v1Result.hash);
              setCurrentVersion({ versionNum: versionsOfThisEntry.length, rootHash: v1Result.hash });
              window.location.hash = `#/entry/${v1Result.hash}`;
            }
          } catch (err) {
            console.error('✗ Error loading entry from URL:', err);
          }
        } else {
          // No URL hash - display demo
          console.log('No URL hash detected, showing demo');
          setTitle(demoV1.title);
          setDescription(demoV1.description);
          setAffirmations(demoV1.affirmations);
          setHeartClicked(demoV1.affirmations.reduce((acc, _, idx) => {
            acc[idx] = true;
            return acc;
          }, {}));
          setViewingEntry({
            hash: v1Result.hash,
            rootHash: v1Result.hash,
            content: demoV1,
            timestamp: demoV1.timestamp
          });
          const history = await getMerkleTree();
          setEntryHistory(history);
          const versionsOfThisEntry = history.filter(h => h.rootHash === v1Result.hash);
          setCurrentVersion({ versionNum: versionsOfThisEntry.length, rootHash: v1Result.hash });
          window.location.hash = `#/entry/${v1Result.hash}`;
        }
        console.log('=== INITIALIZATION COMPLETED ===');
      } catch (err) {
        console.error('✗ Failed to initialize DB:', err);
      }
    };
    init();
  }, []);

  // Generate affirmations using Wisest API
  const sendAPI = async () => {
    if (!title.trim() || !description.trim()) {
      showMessage("Please fill in title and description");
      showPopup(true);
      return;
    }

    setLoading(true);

    try {
      // Call Wisest backend for affirmation generation (uses Gemini API)
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000'
      const endpoint = `${apiUrl}/affirmations`;
      console.log('Calling endpoint:', endpoint);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title,
          description,
          mood: 'neutral'
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Handle both array response and object with affirmations property
      const affirmationsList = Array.isArray(data) ? data : data.affirmations || data;

      // Filter out empty strings and invalid entries
      const validAffirmations = affirmationsList.filter(
        (aff) => typeof aff === 'string' && aff.trim().length > 0
      );

      if (validAffirmations.length === 0) {
        showMessage("Failed to generate affirmations. Please try again.");
        showPopup(true);
        return;
      }

      setAffirmations(validAffirmations);
      setHeartClicked({});
    } catch (error) {
      console.error('Error generating affirmations:', error);
      showMessage("Failed to connect to affirmation service. Make sure Wisest backend is running.");
      showPopup(true);
    } finally {
      setLoading(false);
    }
  }

  // Auto-save entry when affirmations are generated
  const autoSaveEntry = async () => {
    if (affirmations.length === 0 || Object.keys(heartClicked).length === 0) {
      return;
    }

    const heartedAffs = affirmations.filter((_, index) => heartClicked[index]);
    const entryData = {
      title,
      description,
      affirmations: heartedAffs,
      mood: "neutral",
      timestamp: new Date().toISOString()
    };

    try {
      // Pass parent hash if we're editing an existing entry
      await saveToStorage(entryData, editingEntryHash);
      showMessage(`Entry saved: "${title}"`);
      showPopup(true);

      // Auto-close popup after 2 seconds
      setTimeout(() => {
        showPopup(false);
      }, 2000);

      // Clear form for new entry
      setTitle("");
      setDescription("");
      setAffirmations([]);
      setHeartClicked({});
      setEditingEntryHash(null);  // Reset editing hash
    } catch (error) {
      console.error('Error saving entry:', error);
    }
  }

  // Handle heart click and auto-save
  const handleHeartClick = (index) => {
    const newHeartClicked = { ...heartClicked, [index]: !heartClicked[index] };
    setHeartClicked(newHeartClicked);
  }

  //Animate the loading dots
  const useLoadingDots = () => {
    const [dots, setDots] = useState('');
    useEffect(() => {
      if (loading) {
        const interval = setInterval(() => {
          setDots(prev => prev.length < 10 ? prev + '.' : '');
        }, 500);
        return () => clearInterval(interval);
      }
    }, [loading]);
    return dots;
  }
  const loadingDots = useLoadingDots();

  // Search functionality
  const handleSearch = async (query) => {
    setSearchQuery(query);
    if (query.trim() === "") {
      setSearchResults([]);
      return;
    }

    try {
      const results = await searchEntries(query);
      setSearchResults(results);
    } catch (error) {
      console.error('Search error:', error);
    }
  }

  // View entry details
  const viewEntryDetails = async (entry) => {
    console.log('=== viewEntryDetails called ===');
    console.log('Entry:', entry);

    setViewingEntry(entry);
    setShowSearch(false);  // Auto-close search when viewing entry
    setEditingEntryHash(entry.hash);  // Mark that we're working with this entry

    // Load entry data into form
    console.log('Setting title:', entry.content.title);
    setTitle(entry.content.title);
    console.log('Setting description:', entry.content.description);
    setDescription(entry.content.description);
    console.log('Setting affirmations:', entry.content.affirmations);
    setAffirmations(entry.content.affirmations);
    setHeartClicked(entry.content.affirmations.reduce((acc, _, idx) => {
      acc[idx] = true;
      return acc;
    }, {}));

    try {
      const history = await getMerkleTree();
      setEntryHistory(history);

      // Calculate version number and use root hash for URL
      const rootHash = entry.rootHash || entry.hash;
      const versionsOfThisEntry = history.filter(h => h.rootHash === rootHash);
      const versionNum = versionsOfThisEntry.length;
      console.log('Setting current version:', { versionNum, rootHash });
      setCurrentVersion({ versionNum, rootHash });

      // Update URL to point to root entry (original/created version)
      console.log('Updating URL hash to:', `#/entry/${rootHash}`);
      window.location.hash = `#/entry/${rootHash}`;
      console.log('=== viewEntryDetails completed ===');
    } catch (error) {
      console.error('Error loading history:', error);
    }
  }

  // Close popup
  const closePopup = () => {
    showPopup(false);
  };

  // Create new entry
  const newEntry = () => {
    closePopup();
    setTitle("");
    setDescription("");
    setAffirmations([]);
    setHeartClicked({});
    setShowSearch(false);
    setViewingEntry(null);
    setEditingEntryHash(null);
    setCurrentVersion(null);
    window.location.hash = '';
  };

  // View saved entries
  const viewEntries = async () => {
    setShowSearch(true);
    setSearchQuery("");
    try {
      const entries = await getAllEntries();
      setSearchResults(entries);
    } catch (error) {
      console.error('Error loading entries:', error);
    }
  };

  return (
    <>
      {/* Top menu bar */}
      <div className="topmenu">
        <div className="bar icon-btn" onClick={newEntry} title="New Entry">
          <span className="tooltip">New Entry</span>
        </div>
        <img src={viteLogo} className="logo" alt="Vite Logo" />
        <div className="search icon-btn" onClick={viewEntries} title="Search Entries">
          <span className="tooltip">Search Entries</span>
        </div>
      </div>

      {/* Search View */}
      {showSearch && (
        <div className="search-view">
          <input
            type="text"
            className="search-input"
            placeholder="Search your entries..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
          />

          {/* Display search results */}
          {searchResults.length > 0 ? (
            <div className="search-results">
              {searchResults.map((result) => (
                <div
                  key={result.hash}
                  className="search-result-item"
                  onClick={() => viewEntryDetails(result)}
                >
                  <h3>{result.content.title}</h3>
                  <p>{result.content.description.substring(0, 100)}...</p>
                  <small>{new Date(result.timestamp).toLocaleDateString()}</small>
                </div>
              ))}
            </div>
          ) : searchQuery.trim() !== "" ? (
            <p className="no-results">No entries found</p>
          ) : null}

          <button className="back-button" onClick={() => setShowSearch(false)}>Back</button>
        </div>
      )}

      {/* Main Layout: Sidebar + Form */}
      <div className="main-layout">
        {/* Left Sidebar - Entry Details */}
        {viewingEntry && (
          <div className="left-sidebar">
            <div className="sidebar-header">
              <h2>{currentVersion ? `V${currentVersion.versionNum}` : 'Entry'}</h2>
              <button
                className="close-sidebar-btn"
                onClick={() => {
                  setViewingEntry(null);
                  setEditingEntryHash(null);
                  setCurrentVersion(null);
                }}
                title="Close sidebar"
              >
                ✕
              </button>
            </div>

            <div className="sidebar-content">
              <div className="sidebar-section">
                <h3>Favorited Affirmations</h3>
                {viewingEntry.content.affirmations.map((aff, idx) => (
                  <div key={idx} className="sidebar-affirmation-container">
                    <div
                      className="sidebar-heart"
                      onClick={() => {
                        // Remove this affirmation from the entry and update database
                        const updatedAffirmations = viewingEntry.content.affirmations.filter((_, i) => i !== idx);
                        const updatedEntry = {
                          ...viewingEntry.content,
                          affirmations: updatedAffirmations
                        };
                        saveToStorage(updatedEntry, viewingEntry.hash).then(() => {
                          setViewingEntry({
                            ...viewingEntry,
                            content: updatedEntry
                          });
                        });
                      }}
                      title="Remove from favorites"
                    >
                      ❤️
                    </div>
                    <p className="sidebar-affirmation">{aff}</p>
                  </div>
                ))}
              </div>

              <div className="sidebar-section">
                <h3>Version History</h3>
                <code className="sidebar-hash">{viewingEntry.hash.substring(0, 16)}...</code>

                <div className="sidebar-merkle-chain">
                  {currentVersion && currentVersion.rootHash ? (
                    entryHistory
                      .filter(h => h.rootHash === currentVersion.rootHash)
                      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
                      .map((version, idx) => (
                        <div key={version.hash} className="sidebar-merkle-node">
                          <small className="node-version">V{idx + 1}</small>
                          <small className="node-action">{version.action}</small>
                          <small className="node-date">{new Date(version.timestamp).toLocaleDateString()}</small>
                        </div>
                      ))
                  ) : (
                    <div className="sidebar-merkle-node">
                      <small className="node-version">V1</small>
                      <small className="node-action">created</small>
                      <small className="node-date">{new Date(viewingEntry.timestamp).toLocaleDateString()}</small>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Main Form Content */}
        <div className="main-form-content">
          {/* Journal Entry */}
          <input
            type="text"
            className="title-box"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="description-container">
            <textarea
              className="description-box"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's on your mind?"
            ></textarea>
            <div className="send-icon" onClick={sendAPI} title="Generate affirmations" />
            {editingEntryHash && (
              <div className="save-edit-icon" onClick={autoSaveEntry} title="Save edits and create new version" />
            )}
          </div>

          <div className="AffirmlySays">
            {loading ? (
              <img src={affirmlyIcon} className="affirmlylogo spinning" alt="Loading" />
            ) : (
              <img src={affirmlyIcon} className="affirmlylogo"></img>
            )}
            <h2>Affirmly Says</h2>
          </div>

          {/* Affirmations generation */}
          {affirmations.length > 0 && (
            <div className="affirmations-container">
              {affirmations.map((affirmation, index) => (
                <div key={index} className="individual-affirmations">
                  <p>{affirmation}</p>
                  <div
                    className={heartClicked[index] ? "hearted-icon" : "heart-icon"}
                    onClick={() => handleHeartClick(index)}
                  />
                </div>
              ))}
              <div>
              <button
                className="save-button"
                onClick={autoSaveEntry}
                disabled={Object.values(heartClicked).filter(Boolean).length === 0}
              >
                Save Entry
              </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Affirmly Entries saved notification */}
      {popup && (
        <div className="popup">
          <div className="popup-content">
            <span className="close" onClick={closePopup}>&times;</span>
            <h2>{popupMessage}</h2>
            <button className="popup-button" onClick={newEntry}>
              New Entry
            </button>
            <button className="popup-button" onClick={viewEntries}>
              View Saved
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default App;
