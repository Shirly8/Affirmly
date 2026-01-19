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

  // Initialize database on mount
  useEffect(() => {
    const init = async () => {
      try {
        await initDB();

        // Create demo entries with Merkle chain if no entries exist
        const entries = await getAllEntries();
        if (entries.length === 0) {
          const demoV1 = {
            title: "Morning Anxiety",
            description: "Feeling overwhelmed about the day ahead",
            affirmations: [
              "I am capable of handling today's challenges",
              "My worries are temporary, not permanent",
              "I choose to focus on what I can control",
            ],
            mood: "neutral",
            timestamp: new Date(Date.now() - 3600000).toISOString()
          };

          const demoV2 = {
            title: "Morning Anxiety",
            description: "Feeling overwhelmed about the day ahead",
            affirmations: [
              "I am strong and resilient",
              "Today is full of new opportunities",
              "I deserve peace and calm",
              "Every challenge makes me stronger",
            ],
            mood: "neutral",
            timestamp: new Date(Date.now() - 1800000).toISOString()
          };

          await saveToStorage(demoV1);
          await saveToStorage(demoV2);
          console.log('Demo entries created with Merkle chain');
        }
      } catch (err) {
        console.error('Failed to initialize DB:', err);
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
    setViewingEntry(entry);
    setShowSearch(false);  // Auto-close search when viewing entry
    try {
      const history = await getMerkleTree();
      setEntryHistory(history);
    } catch (error) {
      console.error('Error loading history:', error);
    }
  }

  // Edit entry - load it back into the form
  const editEntry = () => {
    if (viewingEntry) {
      setTitle(viewingEntry.content.title);
      setDescription(viewingEntry.content.description);
      setAffirmations(viewingEntry.content.affirmations);
      setHeartClicked(viewingEntry.content.affirmations.reduce((acc, _, idx) => {
        acc[idx] = true;
        return acc;
      }, {}));
      setEditingEntryHash(viewingEntry.hash);  // Track that we're editing this entry
      setViewingEntry(null);
      setShowSearch(false);
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
        <div className="search icon-btn" onClick={() => setShowSearch(!showSearch)} title="Search Entries">
          <span className="tooltip">Search Entries</span>
        </div>
      </div>

      {/* Search View */}
      {showSearch ? (
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
      ) : viewingEntry ? (
        /* Entry Details View */
        <div className="entry-details-view">
          <div className="entry-actions">
            <button className="back-button" onClick={() => setViewingEntry(null)}>← Back</button>
            <button className="edit-button" onClick={editEntry}>✏️ Edit Entry</button>
          </div>

          <h2>{viewingEntry.content.title}</h2>
          <p>{viewingEntry.content.description}</p>

          <div className="affirmations-section">
            <h3>Favorited Affirmations:</h3>
            {viewingEntry.content.affirmations.map((aff, idx) => (
              <p key={idx} className="saved-affirmation">❤️ {aff}</p>
            ))}
          </div>

          <div className="history-section">
            <h3>📋 Current Version Hash (SHA-256):</h3>
            <code className="hash-display">{viewingEntry.hash}</code>

            <h3>🔗 Merkle Chain History:</h3>
            <div className="merkle-chain">
              {entryHistory.filter(h => h.hash === viewingEntry.hash).length > 0 ? (
                entryHistory
                  .filter(h => h.hash === viewingEntry.hash ||
                               entryHistory.some(e => e.parentHash === h.hash && (e.hash === viewingEntry.hash || entryHistory.some(x => x.parentHash === e.hash && x.hash === viewingEntry.hash))))
                  .reverse()
                  .map((version, idx) => (
                    <div key={version.hash} className="merkle-node">
                      <div className="version-number">V{idx + 1}</div>
                      <div className="node-content">
                        <small className="version-action">{version.action}</small>
                        <small className="version-date">{new Date(version.timestamp).toLocaleString()}</small>
                        <code className="version-hash">{version.hash.substring(0, 16)}...</code>
                      </div>
                      {idx < entryHistory.filter(h => h.hash === viewingEntry.hash ||
                                                        entryHistory.some(e => e.parentHash === h.hash && (e.hash === viewingEntry.hash || entryHistory.some(x => x.parentHash === e.hash && x.hash === viewingEntry.hash)))).reverse().length - 1 && (
                        <div className="chain-link">↓ parent</div>
                      )}
                    </div>
                  ))
              ) : (
                <div className="merkle-node">
                  <div className="version-number">V1</div>
                  <div className="node-content">
                    <small className="version-action">created</small>
                    <small className="version-date">{new Date(viewingEntry.timestamp).toLocaleString()}</small>
                    <code className="version-hash">{viewingEntry.hash.substring(0, 16)}...</code>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Main Journal Entry View */
        <>
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
            <div className="send-icon" onClick={sendAPI} />
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
              <button
                className="save-button"
                onClick={autoSaveEntry}
                disabled={Object.values(heartClicked).filter(Boolean).length === 0}
              >
                💾 Save Entry
              </button>
            </div>
          )}
        </>
      )}

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
