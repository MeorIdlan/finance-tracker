import { Test } from '@nestjs/testing';
import { MongooseModule } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { DatabaseModule } from '../database/database.module';
import { AuditLogService } from './audit.service';
import { startMemoryMongo } from '../../test/utils/mongo';

describe('AuditLogService', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let service: AuditLogService;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(mongo.uri), DatabaseModule],
      providers: [AuditLogService],
    }).compile();
    service = moduleRef.get(AuditLogService);
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongo.stop();
  });

  it('logs and lists entries newest-first with pagination', async () => {
    const userId = new Types.ObjectId();
    await service.log({ userId, action: 'auth.login' });
    await service.log({
      userId,
      action: 'passkey.added',
      entityType: 'Credential',
      entityId: 'cred-1',
      metadata: { deviceLabel: 'Laptop' },
    });
    const page = await service.list(userId.toHexString(), 1, 10);
    expect(page.total).toBe(2);
    expect(page.items[0].action).toBe('passkey.added');
    expect(page.items[1].action).toBe('auth.login');
  });

  it('does not return other users entries', async () => {
    const other = await service.list(new Types.ObjectId().toHexString(), 1, 10);
    expect(other.total).toBe(0);
  });
});
