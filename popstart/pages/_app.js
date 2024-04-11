// pages/_app.js
import React from 'react';
import { ApolloProvider } from '@apollo/client';
import { ApolloClient, InMemoryCache, HttpLink } from '@apollo/client';
import '../styles/globals.css'; // Example of importing global styles, adjust the path as necessary

const client = new ApolloClient({
  link: new HttpLink({ uri: '/api/graphql' }), // Assuming you have a Next.js API route set up for GraphQL
  cache: new InMemoryCache(),
});

function MyApp({ Component, pageProps }) {
  return (
    <ApolloProvider client={client}>
      <Component {...pageProps} />
    </ApolloProvider>
  );
}

export default MyApp;
