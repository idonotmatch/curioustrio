// Import required packages
const { ApolloServer, gql } = require('apollo-server');
const { API_KEY } = require('./schema'); // Import API key from schema.ts
const fetch = require('node-fetch'); // Add node-fetch for server-side fetching

// Define your GraphQL schema
const typeDefs = gql`
  type Query {
    amazonProductSearchResults(searchTerm: String!): [Product]
  }

  type Product {
    asin: String
    brand: String
    countryOfOrigin: String
    imageUrls: [String]
    title: String
    url: String
    rating: Float
    ratingsTotal: Int
    reviewsTotal: Int
    featureBullets: [String]
  }
`;

// Define resolver functions
const resolvers = {
  Query: {
    amazonProductSearchResults: async (_, { searchTerm }) => {
      try {
        // Call function to fetch data from GraphQL API
        const data = await fetchGraphQLData(searchTerm);
        // Extract and return product results from the response
        return data?.data?.amazonProductSearchResults?.productResults?.results || [];
      } catch (error) {
        console.error('Error fetching data:', error);
        return [];
      }
    },
  },
};

// Function to fetch data from GraphQL API
async function fetchGraphQLData(searchTerm) {
  const query = `
    query MyQuery($searchTerm: String!) {
      amazonProductSearchResults(input: { searchTerm: $searchTerm, refinements: {} }) {
        productResults {
          results {
            asin
            brand
            countryOfOrigin
            imageUrls
            title
            url
            rating
            ratingsTotal
            reviewsTotal
            featureBullets
          }
        }
      }
    }
  `;

  const variables = {
    searchTerm: searchTerm,
  };

  const response = await fetch('https://graphql.canopyapi.co/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'API-KEY': API_KEY, // Use the imported API key
    },
    body: JSON.stringify({ query, variables }),
  });

  const data = await response.json();
  return data;
}

// Create an Apollo Server instance
const server = new ApolloServer({ typeDefs, resolvers });

// Start the server
server.listen().then(({ url }) => {
  console.log(`Server ready at ${url}`);
});