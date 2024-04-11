// pages/index.js
import React, { useState } from 'react';

function HomePage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');

  const handleSearch = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchTerm }),
      });
      const data = await response.json();
      if (data.errors) {
        setError('Failed to fetch results');
        setResults([]);
      } else {
        // Assuming the structure of the data includes amazonProductSearchResults
        setResults(data.amazonProductSearchResults || []);
      }
    } catch (err) {
      console.error('Fetch error:', err);
      setError('Failed to fetch results');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <form onSubmit={handleSearch} style={{ marginBottom: "20px" }}>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="What are we looking for today?"
          style={{ marginRight: "10px", padding: "10px" }}
        />
        <button type="submit" style={{ padding: "10px" }}>Search</button>
      </form>
      {loading && <p>Loading...</p>}
      {error && <p>Error: {error}</p>}
      <div id="searchResults">
        {results.length > 0 ? (
          results.map((result) => (
            <div key={result.asin} style={{ marginBottom: "20px", borderBottom: "1px solid #ccc", paddingBottom: "10px" }}>
              <h2>{result.title}</h2>
              <p>Brand: {result.brand}</p>
              <p>Rating: {result.rating} ({result.ratingsTotal} reviews)</p>
              {result.imageUrls && result.imageUrls[0] && (
                <img src={result.imageUrls[0]} alt={result.title} style={{ maxWidth: "100px", marginBottom: "10px" }} />
              )}
              <a href={result.url} target="_blank" rel="noreferrer">View Product</a>
              {result.featureBullets && (
                <ul>
                  {result.featureBullets.map((bullet, index) => (
                    <li key={index}>{bullet}</li>
                  ))}
                </ul>
              )}
            </div>
          ))
        ) : (
          !loading && <p>No results found. Try another search.</p>
        )}
      </div>
    </div>
  );
}

export default HomePage;
