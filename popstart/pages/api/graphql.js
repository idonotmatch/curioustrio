// pages/api/graphql.js
import { ApolloServer, gql } from 'apollo-server-micro';
import fetch from 'node-fetch';

// Assuming the schema from your app.js looks something like this
const typeDefs = gql`
  type Query {
    amazonProductSearchResults(searchTerm: String!): [Product]
  }

  type Product {
    asin: String
    brand: String
    title: String
    imageUrls: [String]
    url: String
    rating: Float
    ratingsTotal: Int
    reviewsTotal: Int
    featureBullets: [String]
  }
`;

const resolvers = {
  Query: {
    amazonProductSearchResults: async (_, { searchTerm }) => {
      const response = await fetch('https://graphql.canopyapi.co/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Ensure your API key is securely stored and accessed
          'Authorization': `Bearer ${process.env.API_KEY}`,
        },
        body: JSON.stringify({
          query: `
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
          `,
          variables: { searchTerm },
        }),
      });
      const { data, errors } = await response.json();
      if (errors) {
        console.error(errors);
        throw new Error('Failed to fetch data');
      }
      return data.amazonProductSearchResults;
    },
  },
};

const apolloServer = new ApolloServer({ typeDefs, resolvers });
const startServer = apolloServer.start();

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.end();
    return false;
  }

  await startServer;
  await apolloServer.createHandler({
    path: '/api/graphql',
  })(req, res);
}

export const config = {
  api: {
    bodyParser: false,
  },
};
