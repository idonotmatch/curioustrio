// Ensure all the necessary imports are at the top
import { ApolloServer } from '@apollo/server';
import { startServerAndCreateNextHandler } from '@as-integrations/next';
import { buildHTTPExecutor } from '@graphql-tools/executor-http';
import { schemaFromExecutor } from '@graphql-tools/wrap';
import { stitchSchemas } from '@graphql-tools/stitch';

const CANOPY_GRAPHQL_ENDPOINT = 'https://graphql.canopyapi.co/';

async function createStitchedSchema() {
  const remoteExecutor = buildHTTPExecutor({
    endpoint: CANOPY_GRAPHQL_ENDPOINT,
    headers: {
      Authorization: `Bearer ${process.env.API_KEY}`,
    },
  });

  const canopySubschema = {
    schema: await schemaFromExecutor(remoteExecutor),
    executor: remoteExecutor,
  };

  return stitchSchemas({
    subschemas: [canopySubschema],
  });
}

export default async (req, res) => {
  const schema = await createStitchedSchema();
  const apolloServer = new ApolloServer({ schema });
  return startServerAndCreateNextHandler(apolloServer)(req, res);
};
