import { MongoMemoryReplSet } from 'mongodb-memory-server';

export async function startMemoryMongo(): Promise<{
  uri: string;
  stop: () => Promise<void>;
}> {
  const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return {
    uri: mongod.getUri('finance-test'),
    stop: async () => {
      await mongod.stop();
    },
  };
}
