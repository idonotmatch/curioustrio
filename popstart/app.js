import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { ApolloClient, InMemoryCache, gql, HttpLink, ApolloProvider, gql, useQuery } from '@apollo/client';

const client = new ApolloClient({
  link: new HttpLink({ uri: 'https://graphql.canopyapi.co/' }), // Adjust this URI to match your GraphQL server
  cache: new InMemoryCache(),
});

const SEARCH_QUERY = gql`
  query amazonProductSearchResults($searchTerm: String!) {
    amazonProductSearchResults(searchTerm: $searchTerm) {
      asin
      brand
      title
      imageUrls
      url
      rating
      ratingsTotal
      reviewsTotal
      featureBullets
    }
  }
`;

const SearchComponent = () => {
  const [searchTerm, setSearchTerm] = useState('');

  const { data, loading, error } = useQuery(SEARCH_QUERY, {
    variables: { searchTerm },
    skip: searchTerm.length === 0, // Skip the query if search term is empty
  });

  const handleSearch = (event) => {
    event.preventDefault();
    const searchTerm = document.getElementById('searchInput').value;
    setSearchTerm(searchTerm);
  };

  return (
    <div>
      <form onSubmit={handleSearch}>
        <input type="text" id="searchInput" placeholder="What are we looking for today?" />
        <button type="submit">Let's Go!</button>
      </form>
      {loading && <p>Loading...</p>}
      {error && <p>Error :( Please try again</p>}
      {data && (
        <div id="searchResults">
          {data.amazonProductSearchResults.map((result) => (
            <div key={result.asin}>
              <h2>{result.title}</h2>
              <p>Brand: {result.brand}</p>
              <p>Rating: {result.rating} ({result.ratingsTotal} reviews)</p>
              <img src={result.imageUrls[0]} alt={result.title} />
              <a href={result.url} target="_blank" rel="noreferrer">View Product</a>
              <ul>
                {result.featureBullets.map((bullet, index) => (
                  <li key={index}>{bullet}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const App = () => (
  <ApolloProvider client={client}>
    <SearchComponent />
  </ApolloProvider>
);

ReactDOM.render(<App />, document.getElementById('root'));
