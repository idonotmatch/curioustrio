<script>
  const { ApolloClient, InMemoryCache, gql, HttpLink } = apolloClient;

  // Create an ApolloClient instance to interact with your GraphQL server
  const client = new ApolloClient({
    link: new HttpLink({ uri: 'http://localhost:3000' }), // Adjust the URI to match your Apollo Server's URL
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
    const { data } = await client.query({
      query: SEARCH_QUERY,
      variables: { searchTerm },
    });

    // Use the response data to update your page's UI
    console.log(data); // For now, we're just logging the data. You should update this part to modify the DOM based on the response
  }

  // Attach the handleSearch function to your form's submit event
  document.getElementById('searchForm').addEventListener('submit', handleSearch);
</script>
