// Import required packages
const { ApolloServer, gql } = require('apollo-server-lambda');
const { API_KEY } = require('./schema'); // Import API key from schema.js
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
        const data = await fetchGraphQLData(searchTerm);
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
  
  const response = await fetch('https://graphql.canopyapi.co/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      query: query,
      variables: { searchTerm },
    }),
  });

  const jsonResponse = await response.json();

  // Error handling for the response
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  // You might need additional error handling here based on the structure
  // of the response data (e.g., checking jsonResponse.errors)

  return jsonResponse.data; // Adjust this return based on the structure of the response
}

// Create an Apollo Server instance for Lambda
const server = new ApolloServer({ typeDefs, resolvers });

// Export the Apollo server handler for AWS Lambda
exports.handler = server.createHandler({
  cors: {
    origin: '*',
    credentials: true,
  },
});
