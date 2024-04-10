// Assuming Apollo Client is correctly included in your project setup
const { ApolloClient, InMemoryCache, gql, HttpLink } = apolloClient;

// Create an ApolloClient instance to interact with your GraphQL server
const client = new ApolloClient({
  link: new HttpLink({ uri: 'https://graphql.canopyapi.co/' }), // Adjust the URI to match your Apollo Server's URL
  cache: new InMemoryCache(),
});

// Function to handle form submission
async function handleSearch(event) {
  event.preventDefault(); // Prevent the default form submission behavior
  const searchTerm = document.getElementById('searchInput').value; // Get the search term from the input field

  // Define your GraphQL query
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

  // Send the query to your GraphQL server
  try {
    const { data } = await client.query({
      query: SEARCH_QUERY,
      variables: { searchTerm },
    });

    // Use the response data to update your page's UI
    if (data && data.amazonProductSearchResults) {
      displaySearchResults(data.amazonProductSearchResults);
    }
  } catch (error) {
    console.error("Error fetching data:", error);
    // Optionally handle the error by showing an error message in the UI
  }
}

// Function to display search results
function displaySearchResults(results) {
  const resultsContainer = document.getElementById('searchResults');
  resultsContainer.innerHTML = ''; // Clear previous results

  results.forEach(result => {
    const resultElement = document.createElement('div');
    resultElement.classList.add('search-result');
    // Construct the result element's content
    const content = `
      <h2>${result.title}</h2>
      <p>Rating: ${result.rating} (${result.ratingsTotal} ratings)</p>
      <p>Brand: ${result.brand}</p>
      <img src="${result.imageUrls[0]}" alt="Product Image">
      <a href="${result.url}" target="_blank">View Product</a>
      <ul>${result.featureBullets.map(bullet => `<li>${bullet}</li>`).join('')}</ul>
    `;
    resultElement.innerHTML = content;
    resultsContainer.appendChild(resultElement);
  });
}

// Attach the handleSearch function to your form's submit event
document.getElementById('searchForm').addEventListener('submit', handleSearch);
