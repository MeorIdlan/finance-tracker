import { MongoMemoryServer } from 'mongodb-memory-server';

export async function startMemoryMongo(): Promise<{
  uri: string;
  stop: () => Promise<void>;
}> {
  const mongod = await MongoMemoryServer.create();
  return {
    uri: mongod.getUri('finance-test'),
    stop: async () => {
      await mongod.stop();
    },
  };
}
