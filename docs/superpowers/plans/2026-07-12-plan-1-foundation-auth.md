# Plan 1 of 3: Foundation + Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monorepo scaffolding plus the complete passwordless auth stack: email+OTP registration via MailerSend (quota-tracked), WebAuthn passkey registration/login, MongoDB-backed sessions with httpOnly cookies, account recovery, passkey management, and audit logging of auth events.

**Architecture:** npm-workspaces monorepo (`shared`, `server`, `client`). `server` is NestJS + Mongoose; `client` is React + Vite with a dev proxy so `/api` is same-origin. Sessions are opaque random tokens (SHA-256-hashed in MongoDB) carried in an `httpOnly` cookie; a session has a `scope` of `pending_passkey` (issued after OTP verification, for both registration and recovery) or `full` (after passkey ceremony). WebAuthn ceremonies use `@simplewebauthn/server` + `@simplewebauthn/browser`.

**Tech Stack:** Node 22+, TypeScript (strict), NestJS 11, Mongoose 8, @simplewebauthn/server 13, @simplewebauthn/browser 13, mailersend SDK, React 19, Vite 7, react-router-dom 7, Jest + ts-jest + supertest + mongodb-memory-server (server tests).

**Spec:** `docs/superpowers/specs/2026-07-12-finance-tracker-design.md`. Plans 2 (financial core) and 3 (dashboard + deployment) follow this plan.

## Global Constraints

- Node >= 22, TypeScript `strict: true` in every package.
- All API routes live under the `/api` global prefix.
- Session cookie: name `sid`, `httpOnly: true`, `sameSite: 'lax'`, `secure` from env `COOKIE_SECURE`; value is the raw token, DB stores only its SHA-256 hash.
- Session scopes: `'pending_passkey'` (15 min TTL) and `'full'` (`SESSION_TTL_DAYS` env, default 30 days).
- OTPs: 6 digits, SHA-256-hashed at rest, 10 min expiry, max 5 verify attempts, single active OTP per (email, purpose).
- Every MailerSend send must pass the quota check first (`EMAIL_MONTHLY_QUOTA` env, default 3000/month).
- Currency is MYR everywhere; no currency field on any schema.
- Audit-log every auth event: `auth.otp_requested`, `auth.registered`, `auth.login`, `auth.logout`, `auth.recovery_started`, `passkey.added`, `passkey.removed`.
- Never return whether an email exists via timing/shape differences you can avoid; `POST /api/auth/register` returns 409 for an existing verified user (accepted v1 trade-off, self-hosted app).
- Commit after every task with a conventional-commit message.
- Env vars (all read via `@nestjs/config`): `PORT` (3000), `MONGODB_URI`, `MAILERSEND_API_KEY`, `MAILERSEND_FROM_EMAIL`, `EMAIL_MONTHLY_QUOTA` (3000), `WEBAUTHN_RP_ID` (localhost), `WEBAUTHN_ORIGIN` (http://localhost:5173), `WEBAUTHN_RP_NAME` (Finance Tracker), `COOKIE_SECURE` (false), `SESSION_TTL_DAYS` (30).

---

### Task 1: Monorepo scaffolding + shared package

**Files:**
- Create: `package.json`, `.gitignore`, `.env.example`
- Create: `shared/package.json`, `shared/tsconfig.json`, `shared/src/index.ts`

**Interfaces:**
- Produces: npm workspace layout; `@finance/shared` package exporting `EXPENSE_CATEGORIES`, `ExpenseCategory`, `TransactionType`, `AuthUser`, `PasskeySummary` (built to `shared/dist`).

- [ ] **Step 1: Create root files**

`package.json`:
```json
{
  "name": "finance-tracker",
  "private": true,
  "workspaces": ["shared", "server", "client"],
  "engines": { "node": ">=22" },
  "scripts": {
    "build:shared": "npm run build --workspace shared",
    "test": "npm run test --workspace server"
  }
}
```

`.gitignore`:
```
node_modules/
dist/
.env
coverage/
```

`.env.example`:
```
PORT=3000
MONGODB_URI=mongodb://localhost:27017/finance-tracker
MAILERSEND_API_KEY=your-key-here
MAILERSEND_FROM_EMAIL=noreply@yourdomain.com
EMAIL_MONTHLY_QUOTA=3000
WEBAUTHN_RP_ID=localhost
WEBAUTHN_ORIGIN=http://localhost:5173
WEBAUTHN_RP_NAME=Finance Tracker
COOKIE_SECURE=false
SESSION_TTL_DAYS=30
```

- [ ] **Step 2: Create the shared package**

`shared/package.json`:
```json
{
  "name": "@finance/shared",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": { "build": "tsc" }
}
```

`shared/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

`shared/src/index.ts`:
```ts
export const EXPENSE_CATEGORIES = [
  'Food',
  'Transport',
  'Entertainment',
  'Bills',
  'Shopping',
  'Health',
  'Other',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export type TransactionType =
  | 'income'
  | 'expense'
  | 'commitmentPayment'
  | 'loanPayment'
  | 'cardPayment'
  | 'cardCharge'
  | 'transfer';

export interface AuthUser {
  id: string;
  email: string;
}

export interface PasskeySummary {
  id: string;
  deviceLabel: string;
  createdAt: string;
}
```

- [ ] **Step 3: Install and build**

Run: `npm install && npm run build:shared`
Expected: no errors; `shared/dist/index.js` and `shared/dist/index.d.ts` exist.

- [ ] **Step 4: Commit**

```bash
git add package.json .gitignore .env.example shared/
git commit -m "chore: scaffold npm-workspaces monorepo with shared types package"
```

---

### Task 2: NestJS server bootstrap with Mongo connection and health endpoint

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/nest-cli.json`
- Create: `server/src/main.ts`, `server/src/app.module.ts`, `server/src/health/health.controller.ts`
- Test: `server/test/health.e2e.spec.ts`, `server/test/utils/mongo.ts`

**Interfaces:**
- Consumes: workspace layout from Task 1.
- Produces: running NestJS app with global prefix `api`, global `ValidationPipe`, `cookie-parser`, Mongoose connected via `MONGODB_URI`; test helper `startMemoryMongo(): Promise<{ uri: string; stop: () => Promise<void> }>`.

- [ ] **Step 1: Create server package files**

`server/package.json`:
```json
{
  "name": "@finance/server",
  "version": "0.1.0",
  "scripts": {
    "build": "nest build",
    "start:dev": "nest start --watch",
    "test": "jest"
  },
  "dependencies": {
    "@finance/shared": "*",
    "@nestjs/common": "^11.0.0",
    "@nestjs/config": "^4.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/mongoose": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@simplewebauthn/server": "^13.0.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "cookie-parser": "^1.4.7",
    "mailersend": "^2.3.0",
    "mongoose": "^8.9.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/testing": "^11.0.0",
    "@types/cookie-parser": "^1.4.8",
    "@types/express": "^5.0.0",
    "@types/jest": "^29.5.14",
    "@types/node": "^22.10.0",
    "@types/supertest": "^6.0.2",
    "jest": "^29.7.0",
    "mongodb-memory-server": "^10.1.0",
    "supertest": "^7.0.0",
    "ts-jest": "^29.2.5",
    "typescript": "^5.7.0"
  },
  "jest": {
    "preset": "ts-jest",
    "testEnvironment": "node",
    "roots": ["<rootDir>/src", "<rootDir>/test"],
    "testRegex": ".*\\.spec\\.ts$",
    "testTimeout": 60000
  }
}
```

`server/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "declaration": false,
    "outDir": "dist",
    "strict": true,
    "strictPropertyInitialization": false,
    "esModuleInterop": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src", "test"]
}
```

`server/nest-cli.json`:
```json
{ "collection": "@nestjs/schematics", "sourceRoot": "src" }
```

- [ ] **Step 2: Write app bootstrap and health controller**

`server/src/main.ts`:
```ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

`server/src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
      }),
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
```

`server/src/health/health.controller.ts`:
```ts
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  health() {
    return { status: 'ok' };
  }
}
```

- [ ] **Step 3: Write the failing e2e test and mongo test helper**

`server/test/utils/mongo.ts`:
```ts
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
```

`server/test/health.e2e.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { startMemoryMongo } from './utils/mongo';

describe('GET /api/health', () => {
  let app: INestApplication;
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await mongo.stop();
  });

  it('returns ok', async () => {
    await request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({ status: 'ok' });
  });
});
```

- [ ] **Step 4: Install and run the test**

Run: `npm install` (from repo root), then `npm test --workspace server`
Expected: PASS (first run downloads the mongodb-memory-server binary; allow a few minutes).

Note: if `npm install` fails on peer resolution, pin the failing package to the version npm suggests — the `^` ranges above are floors, not exact pins.

- [ ] **Step 5: Verify the dev server boots**

Run: `cp .env.example .env` then `npm run start:dev --workspace server` (needs a local Mongo running, or temporarily set `MONGODB_URI` to a memory-server URI — a running local Mongo arrives with docker-compose in Task 15; it is fine to skip this step until then and rely on the e2e test).
Expected: Nest logs `Nest application successfully started`.

- [ ] **Step 6: Commit**

```bash
git add server/ package-lock.json
git commit -m "feat(server): bootstrap NestJS app with Mongo connection and health endpoint"
```

---

### Task 3: Mongoose schemas + DatabaseModule

**Files:**
- Create: `server/src/database/schemas/user.schema.ts`, `credential.schema.ts`, `otp-code.schema.ts`, `session.schema.ts`, `webauthn-challenge.schema.ts`, `email-quota.schema.ts`, `audit-log.schema.ts` (all under `server/src/database/schemas/`)
- Create: `server/src/database/database.module.ts`
- Modify: `server/src/app.module.ts` (import DatabaseModule)
- Test: `server/test/schemas.spec.ts`

**Interfaces:**
- Produces: `DatabaseModule` (global) exporting Mongoose models injectable via `@InjectModel(User.name)` etc. Document classes: `User { email, emailVerified, createdAt }`, `Credential { userId, credentialId, publicKey: Buffer, counter, deviceLabel, createdAt }`, `OtpCode { email, codeHash, purpose, expiresAt, consumedAt?, attempts }`, `Session { tokenHash, userId, scope, expiresAt, createdAt }`, `WebauthnChallenge { challenge, email?, userId?, type, expiresAt }`, `EmailQuotaUsage { yearMonth, count }`, `AuditLog { userId, action, entityType?, entityId?, metadata?, timestamp }`.

- [ ] **Step 1: Write the failing schema round-trip test**

`server/test/schemas.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DatabaseModule } from '../src/database/database.module';
import { User } from '../src/database/schemas/user.schema';
import { Session } from '../src/database/schemas/session.schema';
import { startMemoryMongo } from './utils/mongo';

describe('database schemas', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(mongo.uri), DatabaseModule],
    }).compile();
    userModel = moduleRef.get(getModelToken(User.name));
    sessionModel = moduleRef.get(getModelToken(Session.name));
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongo.stop();
  });

  it('round-trips a user and enforces unique email', async () => {
    const user = await userModel.create({ email: 'a@b.com', emailVerified: true });
    expect(user.email).toBe('a@b.com');
    await userModel.ensureIndexes();
    await expect(
      userModel.create({ email: 'a@b.com', emailVerified: false }),
    ).rejects.toThrow();
  });

  it('round-trips a session with scope', async () => {
    const s = await sessionModel.create({
      tokenHash: 'h'.repeat(64),
      userId: (await userModel.findOne())!._id,
      scope: 'pending_passkey',
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(s.scope).toBe('pending_passkey');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace server -- schemas`
Expected: FAIL — cannot find module `../src/database/database.module`.

- [ ] **Step 3: Write the schemas**

`server/src/database/schemas/user.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema()
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ default: false })
  emailVerified: boolean;

  @Prop({ default: () => new Date() })
  createdAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
```

`server/src/database/schemas/credential.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CredentialDocument = HydratedDocument<Credential>;

@Schema()
export class Credential {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, unique: true })
  credentialId: string;

  @Prop({ type: Buffer, required: true })
  publicKey: Buffer;

  @Prop({ required: true, default: 0 })
  counter: number;

  @Prop({ default: 'Passkey' })
  deviceLabel: string;

  @Prop({ default: () => new Date() })
  createdAt: Date;
}

export const CredentialSchema = SchemaFactory.createForClass(Credential);
```

`server/src/database/schemas/otp-code.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OtpPurpose = 'register' | 'recovery';
export type OtpCodeDocument = HydratedDocument<OtpCode>;

@Schema()
export class OtpCode {
  @Prop({ required: true, index: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true })
  codeHash: string;

  @Prop({ required: true, enum: ['register', 'recovery'] })
  purpose: OtpPurpose;

  @Prop({ required: true })
  expiresAt: Date;

  @Prop()
  consumedAt?: Date;

  @Prop({ default: 0 })
  attempts: number;
}

export const OtpCodeSchema = SchemaFactory.createForClass(OtpCode);
OtpCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
```

`server/src/database/schemas/session.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SessionScope = 'pending_passkey' | 'full';
export type SessionDocument = HydratedDocument<Session>;

@Schema()
export class Session {
  @Prop({ required: true, unique: true })
  tokenHash: string;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: ['pending_passkey', 'full'] })
  scope: SessionScope;

  @Prop({ required: true })
  expiresAt: Date;

  @Prop({ default: () => new Date() })
  createdAt: Date;
}

export const SessionSchema = SchemaFactory.createForClass(Session);
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
```

`server/src/database/schemas/webauthn-challenge.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ChallengeType = 'registration' | 'authentication';
export type WebauthnChallengeDocument = HydratedDocument<WebauthnChallenge>;

@Schema()
export class WebauthnChallenge {
  @Prop({ required: true })
  challenge: string;

  @Prop({ lowercase: true, trim: true })
  email?: string;

  @Prop({ type: Types.ObjectId })
  userId?: Types.ObjectId;

  @Prop({ required: true, enum: ['registration', 'authentication'] })
  type: ChallengeType;

  @Prop({ required: true })
  expiresAt: Date;
}

export const WebauthnChallengeSchema =
  SchemaFactory.createForClass(WebauthnChallenge);
WebauthnChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
```

`server/src/database/schemas/email-quota.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type EmailQuotaUsageDocument = HydratedDocument<EmailQuotaUsage>;

@Schema()
export class EmailQuotaUsage {
  @Prop({ required: true, unique: true })
  yearMonth: string;

  @Prop({ default: 0 })
  count: number;
}

export const EmailQuotaUsageSchema =
  SchemaFactory.createForClass(EmailQuotaUsage);
```

`server/src/database/schemas/audit-log.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';

export type AuditLogDocument = HydratedDocument<AuditLog>;

@Schema()
export class AuditLog {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  action: string;

  @Prop()
  entityType?: string;

  @Prop()
  entityId?: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  metadata?: Record<string, unknown>;

  @Prop({ default: () => new Date(), index: true })
  timestamp: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
```

- [ ] **Step 4: Write the DatabaseModule and wire it in**

`server/src/database/database.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { Credential, CredentialSchema } from './schemas/credential.schema';
import { OtpCode, OtpCodeSchema } from './schemas/otp-code.schema';
import { Session, SessionSchema } from './schemas/session.schema';
import {
  WebauthnChallenge,
  WebauthnChallengeSchema,
} from './schemas/webauthn-challenge.schema';
import {
  EmailQuotaUsage,
  EmailQuotaUsageSchema,
} from './schemas/email-quota.schema';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';

const models = MongooseModule.forFeature([
  { name: User.name, schema: UserSchema },
  { name: Credential.name, schema: CredentialSchema },
  { name: OtpCode.name, schema: OtpCodeSchema },
  { name: Session.name, schema: SessionSchema },
  { name: WebauthnChallenge.name, schema: WebauthnChallengeSchema },
  { name: EmailQuotaUsage.name, schema: EmailQuotaUsageSchema },
  { name: AuditLog.name, schema: AuditLogSchema },
]);

@Global()
@Module({
  imports: [models],
  exports: [models],
})
export class DatabaseModule {}
```

In `server/src/app.module.ts`, add `DatabaseModule` to the `imports` array:
```ts
import { DatabaseModule } from './database/database.module';
// ...
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
      }),
    }),
    DatabaseModule,
  ],
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test --workspace server`
Expected: both `schemas` tests and the health e2e test PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/database/ server/src/app.module.ts server/test/schemas.spec.ts
git commit -m "feat(server): add Mongoose schemas and global DatabaseModule"
```

---

### Task 4: AuditLogService

**Files:**
- Create: `server/src/audit/audit.module.ts`, `server/src/audit/audit.service.ts`
- Modify: `server/src/app.module.ts` (import AuditModule)
- Test: `server/src/audit/audit.service.spec.ts`

**Interfaces:**
- Consumes: `AuditLog` model from DatabaseModule.
- Produces: `AuditLogService.log(entry: { userId: string | Types.ObjectId; action: string; entityType?: string; entityId?: string; metadata?: Record<string, unknown> }): Promise<void>` and `AuditLogService.list(userId: string, page: number, pageSize: number): Promise<{ items: AuditLog[]; total: number }>`. `AuditModule` exports `AuditLogService` and is imported by AppModule (and later by AuthModule/PasskeysModule).

- [ ] **Step 1: Write the failing test**

`server/src/audit/audit.service.spec.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace server -- audit`
Expected: FAIL — cannot find module `./audit.service`.

- [ ] **Step 3: Implement the service and module**

`server/src/audit/audit.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditLog } from '../database/schemas/audit-log.schema';

export interface AuditEntry {
  userId: string | Types.ObjectId;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditLogService {
  constructor(
    @InjectModel(AuditLog.name) private auditModel: Model<AuditLog>,
  ) {}

  async log(entry: AuditEntry): Promise<void> {
    await this.auditModel.create({
      ...entry,
      userId: new Types.ObjectId(entry.userId),
    });
  }

  async list(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: AuditLog[]; total: number }> {
    const filter = { userId: new Types.ObjectId(userId) };
    const [items, total] = await Promise.all([
      this.auditModel
        .find(filter)
        .sort({ timestamp: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      this.auditModel.countDocuments(filter),
    ]);
    return { items, total };
  }
}
```

`server/src/audit/audit.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AuditLogService } from './audit.service';

@Module({
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
```

Add `AuditModule` to `server/src/app.module.ts` imports.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace server -- audit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/audit/ server/src/app.module.ts
git commit -m "feat(server): add AuditLogService with paginated per-user listing"
```

---

### Task 5: EmailService with MailerSend + quota tracking

**Files:**
- Create: `server/src/email/email.module.ts`, `server/src/email/email.service.ts`
- Modify: `server/src/app.module.ts` (import EmailModule)
- Test: `server/src/email/email.service.spec.ts`

**Interfaces:**
- Consumes: `EmailQuotaUsage` model; env `MAILERSEND_API_KEY`, `MAILERSEND_FROM_EMAIL`, `EMAIL_MONTHLY_QUOTA`.
- Produces: `EmailService.sendOtpEmail(to: string, code: string): Promise<void>` — throws `ServiceUnavailableException` when the monthly quota is exhausted. `EmailModule` exports `EmailService`.

- [ ] **Step 1: Write the failing test**

`server/src/email/email.service.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { Model } from 'mongoose';
import { DatabaseModule } from '../database/database.module';
import { EmailQuotaUsage } from '../database/schemas/email-quota.schema';
import { EmailService } from './email.service';
import { startMemoryMongo } from '../../test/utils/mongo';

const sendMock = jest.fn().mockResolvedValue(undefined);
jest.mock('mailersend', () => {
  class EmailParams {
    setFrom() { return this; }
    setTo() { return this; }
    setSubject() { return this; }
    setText() { return this; }
  }
  return {
    MailerSend: jest.fn().mockImplementation(() => ({
      email: { send: sendMock },
    })),
    EmailParams,
    Sender: jest.fn(),
    Recipient: jest.fn(),
  };
});

describe('EmailService', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let service: EmailService;
  let quotaModel: Model<EmailQuotaUsage>;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(mongo.uri), DatabaseModule],
      providers: [
        EmailService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, def?: unknown) =>
              ({
                MAILERSEND_API_KEY: 'test-key',
                MAILERSEND_FROM_EMAIL: 'noreply@test.com',
                EMAIL_MONTHLY_QUOTA: '3',
              })[key] ?? def,
            getOrThrow: (key: string) =>
              ({
                MAILERSEND_API_KEY: 'test-key',
                MAILERSEND_FROM_EMAIL: 'noreply@test.com',
              })[key],
          },
        },
      ],
    }).compile();
    service = moduleRef.get(EmailService);
    quotaModel = moduleRef.get(getModelToken(EmailQuotaUsage.name));
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongo.stop();
  });

  it('sends and increments the monthly counter', async () => {
    await service.sendOtpEmail('a@b.com', '123456');
    expect(sendMock).toHaveBeenCalledTimes(1);
    const row = await quotaModel.findOne().lean();
    expect(row!.count).toBe(1);
  });

  it('hard-stops once quota is reached', async () => {
    await service.sendOtpEmail('a@b.com', '123456');
    await service.sendOtpEmail('a@b.com', '123456');
    await expect(service.sendOtpEmail('a@b.com', '123456')).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(sendMock).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace server -- email`
Expected: FAIL — cannot find module `./email.service`.

- [ ] **Step 3: Implement the service**

`server/src/email/email.service.ts`:
```ts
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MailerSend, EmailParams, Sender, Recipient } from 'mailersend';
import { EmailQuotaUsage } from '../database/schemas/email-quota.schema';

@Injectable()
export class EmailService {
  private mailer: MailerSend;
  private from: string;
  private quota: number;

  constructor(
    private config: ConfigService,
    @InjectModel(EmailQuotaUsage.name)
    private quotaModel: Model<EmailQuotaUsage>,
  ) {
    this.mailer = new MailerSend({
      apiKey: this.config.getOrThrow<string>('MAILERSEND_API_KEY'),
    });
    this.from = this.config.getOrThrow<string>('MAILERSEND_FROM_EMAIL');
    this.quota = parseInt(this.config.get('EMAIL_MONTHLY_QUOTA', '3000'), 10);
  }

  private yearMonth(): string {
    return new Date().toISOString().slice(0, 7); // e.g. "2026-07"
  }

  private async reserveQuotaSlot(): Promise<void> {
    // Atomically increment only while below quota; null result = exhausted
    // or the row does not exist yet.
    const updated = await this.quotaModel.findOneAndUpdate(
      { yearMonth: this.yearMonth(), count: { $lt: this.quota } },
      { $inc: { count: 1 } },
      { new: true },
    );
    if (updated) return;
    const existing = await this.quotaModel.findOne({
      yearMonth: this.yearMonth(),
    });
    if (existing) {
      throw new ServiceUnavailableException(
        'Monthly email quota reached. Please try again later.',
      );
    }
    await this.quotaModel.create({ yearMonth: this.yearMonth(), count: 1 });
  }

  async sendOtpEmail(to: string, code: string): Promise<void> {
    await this.reserveQuotaSlot();
    const params = new EmailParams()
      .setFrom(new Sender(this.from, 'Finance Tracker'))
      .setTo([new Recipient(to)])
      .setSubject('Your Finance Tracker verification code')
      .setText(
        `Your verification code is: ${code}\n\nIt expires in 10 minutes. If you did not request this, ignore this email.`,
      );
    await this.mailer.email.send(params);
  }
}
```

`server/src/email/email.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { EmailService } from './email.service';

@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
```

Add `EmailModule` to `server/src/app.module.ts` imports.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace server -- email`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/email/ server/src/app.module.ts
git commit -m "feat(server): add EmailService with MailerSend and monthly quota hard-stop"
```

---

### Task 6: OtpService

**Files:**
- Create: `server/src/auth/otp.service.ts`
- Test: `server/src/auth/otp.service.spec.ts`

**Interfaces:**
- Consumes: `OtpCode` model.
- Produces: `OtpService.issue(email: string, purpose: 'register' | 'recovery'): Promise<string>` (returns the plaintext 6-digit code for the caller to email; replaces any existing active OTP for that email+purpose) and `OtpService.verify(email: string, purpose: 'register' | 'recovery', code: string): Promise<boolean>` (consumes on success; increments attempts and returns false on mismatch; false when expired/consumed/missing or after 5 failed attempts).

- [ ] **Step 1: Write the failing test**

`server/src/auth/otp.service.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DatabaseModule } from '../database/database.module';
import { OtpCode } from '../database/schemas/otp-code.schema';
import { OtpService } from './otp.service';
import { startMemoryMongo } from '../../test/utils/mongo';

describe('OtpService', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let service: OtpService;
  let otpModel: Model<OtpCode>;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(mongo.uri), DatabaseModule],
      providers: [OtpService],
    }).compile();
    service = moduleRef.get(OtpService);
    otpModel = moduleRef.get(getModelToken(OtpCode.name));
  });

  afterEach(async () => {
    await otpModel.deleteMany({});
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongo.stop();
  });

  it('issues a 6-digit code and verifies it once', async () => {
    const code = await service.issue('a@b.com', 'register');
    expect(code).toMatch(/^\d{6}$/);
    expect(await service.verify('a@b.com', 'register', code)).toBe(true);
    expect(await service.verify('a@b.com', 'register', code)).toBe(false);
  });

  it('stores only a hash, never the plaintext', async () => {
    const code = await service.issue('a@b.com', 'register');
    const doc = await otpModel.findOne().lean();
    expect(doc!.codeHash).not.toContain(code);
  });

  it('re-issuing replaces the previous code', async () => {
    const first = await service.issue('a@b.com', 'register');
    const second = await service.issue('a@b.com', 'register');
    expect(await service.verify('a@b.com', 'register', first)).toBe(false);
    expect(await service.verify('a@b.com', 'register', second)).toBe(true);
  });

  it('locks out after 5 wrong attempts', async () => {
    const code = await service.issue('a@b.com', 'register');
    for (let i = 0; i < 5; i++) {
      expect(await service.verify('a@b.com', 'register', '000000')).toBe(false);
    }
    expect(await service.verify('a@b.com', 'register', code)).toBe(false);
  });

  it('rejects an expired code', async () => {
    const code = await service.issue('a@b.com', 'register');
    await otpModel.updateOne({}, { expiresAt: new Date(Date.now() - 1000) });
    expect(await service.verify('a@b.com', 'register', code)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace server -- otp`
Expected: FAIL — cannot find module `./otp.service`.

- [ ] **Step 3: Implement the service**

`server/src/auth/otp.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash, randomInt } from 'crypto';
import { OtpCode, OtpPurpose } from '../database/schemas/otp-code.schema';

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function hash(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

@Injectable()
export class OtpService {
  constructor(@InjectModel(OtpCode.name) private otpModel: Model<OtpCode>) {}

  async issue(email: string, purpose: OtpPurpose): Promise<string> {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.otpModel.findOneAndUpdate(
      { email: email.toLowerCase(), purpose },
      {
        codeHash: hash(code),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
        consumedAt: null,
        attempts: 0,
      },
      { upsert: true },
    );
    return code;
  }

  async verify(
    email: string,
    purpose: OtpPurpose,
    code: string,
  ): Promise<boolean> {
    const doc = await this.otpModel.findOne({
      email: email.toLowerCase(),
      purpose,
    });
    if (
      !doc ||
      doc.consumedAt ||
      doc.expiresAt < new Date() ||
      doc.attempts >= MAX_ATTEMPTS
    ) {
      return false;
    }
    if (doc.codeHash !== hash(code)) {
      await this.otpModel.updateOne({ _id: doc._id }, { $inc: { attempts: 1 } });
      return false;
    }
    await this.otpModel.updateOne({ _id: doc._id }, { consumedAt: new Date() });
    return true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace server -- otp`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/auth/otp.service.ts server/src/auth/otp.service.spec.ts
git commit -m "feat(server): add OtpService with hashing, expiry, and attempt lockout"
```

---

### Task 7: SessionService, AuthGuard, and CurrentUser decorator

**Files:**
- Create: `server/src/auth/session.service.ts`, `server/src/auth/auth.guard.ts`, `server/src/auth/current-user.decorator.ts`
- Test: `server/src/auth/session.service.spec.ts`

**Interfaces:**
- Consumes: `Session` and `User` models; env `SESSION_TTL_DAYS`.
- Produces:
  - `SessionService.create(userId: Types.ObjectId, scope: 'pending_passkey' | 'full'): Promise<string>` — returns the raw token (pending sessions expire in 15 min, full in `SESSION_TTL_DAYS`).
  - `SessionService.validate(token: string): Promise<RequestUser | null>` where `RequestUser = { sessionId: string; userId: string; scope: SessionScope; email: string }`.
  - `SessionService.upgrade(sessionId: string): Promise<void>` — sets scope `full` and extends expiry.
  - `SessionService.destroy(token: string): Promise<void>`.
  - `AuthGuard` — reads the `sid` cookie, validates, attaches `request.user: RequestUser`, throws 401 if invalid. Requires scope `full` unless the handler/class is decorated with `@AllowPendingSession()`.
  - `@CurrentUser()` param decorator returning `request.user` (type `RequestUser`).

- [ ] **Step 1: Write the failing test**

`server/src/auth/session.service.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { DatabaseModule } from '../database/database.module';
import { User } from '../database/schemas/user.schema';
import { Session } from '../database/schemas/session.schema';
import { SessionService } from './session.service';
import { startMemoryMongo } from '../../test/utils/mongo';

describe('SessionService', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let service: SessionService;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(mongo.uri), DatabaseModule],
      providers: [
        SessionService,
        {
          provide: ConfigService,
          useValue: { get: (_k: string, def?: unknown) => def },
        },
      ],
    }).compile();
    service = moduleRef.get(SessionService);
    userModel = moduleRef.get(getModelToken(User.name));
    sessionModel = moduleRef.get(getModelToken(Session.name));
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongo.stop();
  });

  it('creates, validates, upgrades, and destroys a session', async () => {
    const user = await userModel.create({
      email: 's@b.com',
      emailVerified: true,
    });
    const token = await service.create(user._id, 'pending_passkey');
    expect(token.length).toBeGreaterThanOrEqual(32);

    const info = await service.validate(token);
    expect(info).not.toBeNull();
    expect(info!.scope).toBe('pending_passkey');
    expect(info!.email).toBe('s@b.com');

    await service.upgrade(info!.sessionId);
    expect((await service.validate(token))!.scope).toBe('full');

    await service.destroy(token);
    expect(await service.validate(token)).toBeNull();
  });

  it('stores only a token hash and rejects expired sessions', async () => {
    const user = await userModel.findOne();
    const token = await service.create(user!._id, 'full');
    const doc = await sessionModel.findOne({}).sort({ createdAt: -1 }).lean();
    expect(doc!.tokenHash).not.toBe(token);
    await sessionModel.updateOne(
      { _id: doc!._id },
      { expiresAt: new Date(Date.now() - 1000) },
    );
    expect(await service.validate(token)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace server -- session`
Expected: FAIL — cannot find module `./session.service`.

- [ ] **Step 3: Implement SessionService**

`server/src/auth/session.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { createHash, randomBytes } from 'crypto';
import { Session, SessionScope } from '../database/schemas/session.schema';
import { User } from '../database/schemas/user.schema';

const PENDING_TTL_MS = 15 * 60 * 1000;

export interface RequestUser {
  sessionId: string;
  userId: string;
  scope: SessionScope;
  email: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class SessionService {
  private fullTtlMs: number;

  constructor(
    private config: ConfigService,
    @InjectModel(Session.name) private sessionModel: Model<Session>,
    @InjectModel(User.name) private userModel: Model<User>,
  ) {
    const days = parseInt(this.config.get('SESSION_TTL_DAYS', '30'), 10);
    this.fullTtlMs = days * 24 * 60 * 60 * 1000;
  }

  async create(userId: Types.ObjectId, scope: SessionScope): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const ttl = scope === 'full' ? this.fullTtlMs : PENDING_TTL_MS;
    await this.sessionModel.create({
      tokenHash: hashToken(token),
      userId,
      scope,
      expiresAt: new Date(Date.now() + ttl),
    });
    return token;
  }

  async validate(token: string): Promise<RequestUser | null> {
    const session = await this.sessionModel.findOne({
      tokenHash: hashToken(token),
      expiresAt: { $gt: new Date() },
    });
    if (!session) return null;
    const user = await this.userModel.findById(session.userId);
    if (!user) return null;
    return {
      sessionId: session._id.toHexString(),
      userId: session.userId.toHexString(),
      scope: session.scope,
      email: user.email,
    };
  }

  async upgrade(sessionId: string): Promise<void> {
    await this.sessionModel.updateOne(
      { _id: new Types.ObjectId(sessionId) },
      { scope: 'full', expiresAt: new Date(Date.now() + this.fullTtlMs) },
    );
  }

  async destroy(token: string): Promise<void> {
    await this.sessionModel.deleteOne({ tokenHash: hashToken(token) });
  }
}
```

- [ ] **Step 4: Implement AuthGuard and CurrentUser decorator**

`server/src/auth/auth.guard.ts`:
```ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { SessionService } from './session.service';

export const ALLOW_PENDING_KEY = 'allowPendingSession';
export const AllowPendingSession = () => SetMetadata(ALLOW_PENDING_KEY, true);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private sessions: SessionService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = (req.cookies as Record<string, string> | undefined)?.sid;
    if (!token) throw new UnauthorizedException();
    const user = await this.sessions.validate(token);
    if (!user) throw new UnauthorizedException();
    const allowPending = this.reflector.getAllAndOverride<boolean>(
      ALLOW_PENDING_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (user.scope !== 'full' && !allowPending) {
      throw new UnauthorizedException('Passkey setup incomplete');
    }
    (req as Request & { user: unknown }).user = user;
    return true;
  }
}
```

`server/src/auth/current-user.decorator.ts`:
```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestUser } from './session.service';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    return ctx.switchToHttp().getRequest().user;
  },
);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --workspace server -- session`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/auth/
git commit -m "feat(server): add SessionService, AuthGuard with scopes, CurrentUser decorator"
```

---

### Task 8: AuthModule with registration + recovery + OTP verification endpoints

**Files:**
- Create: `server/src/auth/auth.module.ts`, `server/src/auth/auth.service.ts`, `server/src/auth/auth.controller.ts`, `server/src/auth/dto.ts`, `server/src/auth/cookie.ts`
- Modify: `server/src/app.module.ts` (import AuthModule)
- Test: `server/test/utils/app.ts`, `server/test/auth-register.e2e.spec.ts`

**Interfaces:**
- Consumes: `OtpService`, `EmailService`, `SessionService`, `AuditLogService`, `User` model.
- Produces:
  - `POST /api/auth/register` body `{ email }` → 201 `{ message }`; 409 if a verified user exists; creates an unverified `User`, issues OTP, emails it, audits `auth.otp_requested`.
  - `POST /api/auth/verify-otp` body `{ email, code, purpose }` → 201 `{ scope: 'pending_passkey' }` + `sid` cookie; 401 on bad/expired code. For `register`, flips `emailVerified` and audits `auth.registered`.
  - `POST /api/auth/recover` body `{ email }` → 201 `{ message }`; 404 if no verified user; audits `auth.recovery_started`.
  - `setSessionCookie(res, config, token)` / `clearSessionCookie(res)` helpers in `cookie.ts`.
  - `AuthModule` exports `SessionService`, `AuthGuard`, `AuditModule` consumers can import it.
  - Test helper `createTestApp(): Promise<{ app: INestApplication; sentCodes: Map<string, string> }>` (EmailService replaced with a capture mock).

- [ ] **Step 1: Write the test helper and failing e2e test**

`server/test/utils/app.ts`:
```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';
import { EmailService } from '../../src/email/email.service';

export interface TestCtx {
  app: INestApplication;
  sentCodes: Map<string, string>;
}

export async function createTestApp(): Promise<TestCtx> {
  const sentCodes = new Map<string, string>();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EmailService)
    .useValue({
      sendOtpEmail: async (to: string, code: string) => {
        sentCodes.set(to, code);
      },
    })
    .compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return { app, sentCodes };
}
```

`server/test/auth-register.e2e.spec.ts`:
```ts
import request from 'supertest';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';

describe('registration and recovery flow', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('registers: email -> otp -> pending session cookie', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'new@user.com' })
      .expect(201);
    const code = ctx.sentCodes.get('new@user.com')!;
    expect(code).toMatch(/^\d{6}$/);

    const res = await request(ctx.app.getHttpServer())
      .post('/api/auth/verify-otp')
      .send({ email: 'new@user.com', code, purpose: 'register' })
      .expect(201);
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toContain('sid=');
    expect(cookie.toLowerCase()).toContain('httponly');
    expect(res.body.scope).toBe('pending_passkey');
  });

  it('rejects a wrong otp with 401', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'two@user.com' })
      .expect(201);
    await request(ctx.app.getHttpServer())
      .post('/api/auth/verify-otp')
      .send({ email: 'two@user.com', code: '000000', purpose: 'register' })
      .expect(401);
  });

  it('returns 409 when registering an already-verified email', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'new@user.com' })
      .expect(409);
  });

  it('recover: 201 for verified user, 404 for unknown', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/auth/recover')
      .send({ email: 'new@user.com' })
      .expect(201);
    await request(ctx.app.getHttpServer())
      .post('/api/auth/recover')
      .send({ email: 'ghost@user.com' })
      .expect(404);
  });

  it('rejects an invalid email with 400', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'not-an-email' })
      .expect(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace server -- auth-register`
Expected: FAIL — 404s on `/api/auth/register` (module not wired) or module-not-found.

- [ ] **Step 3: Write DTOs and cookie helpers**

`server/src/auth/dto.ts`:
```ts
import {
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export class EmailDto {
  @IsEmail()
  email: string;
}

export class VerifyOtpDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(6, 6)
  code: string;

  @IsIn(['register', 'recovery'])
  purpose: 'register' | 'recovery';
}

export class PasskeyVerifyDto {
  @IsObject()
  response: Record<string, unknown>;

  @IsOptional()
  @IsString()
  deviceLabel?: string;
}

export class LoginVerifyDto {
  @IsString()
  challengeId: string;

  @IsObject()
  response: Record<string, unknown>;
}
```

`server/src/auth/cookie.ts`:
```ts
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';

export function setSessionCookie(
  res: Response,
  config: ConfigService,
  token: string,
): void {
  const days = parseInt(config.get('SESSION_TTL_DAYS', '30'), 10);
  res.cookie('sid', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.get('COOKIE_SECURE', 'false') === 'true',
    maxAge: days * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie('sid', { path: '/' });
}
```

- [ ] **Step 4: Write AuthService, AuthController, AuthModule**

`server/src/auth/auth.service.ts`:
```ts
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../database/schemas/user.schema';
import { OtpPurpose } from '../database/schemas/otp-code.schema';
import { OtpService } from './otp.service';
import { SessionService } from './session.service';
import { EmailService } from '../email/email.service';
import { AuditLogService } from '../audit/audit.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    private otp: OtpService,
    private email: EmailService,
    private sessions: SessionService,
    private audit: AuditLogService,
  ) {}

  async startRegistration(email: string): Promise<void> {
    const normalized = email.toLowerCase();
    const existing = await this.userModel.findOne({ email: normalized });
    if (existing?.emailVerified) {
      throw new ConflictException('Account already exists. Log in instead.');
    }
    const user =
      existing ??
      (await this.userModel.create({ email: normalized, emailVerified: false }));
    const code = await this.otp.issue(normalized, 'register');
    await this.email.sendOtpEmail(normalized, code);
    await this.audit.log({
      userId: user._id,
      action: 'auth.otp_requested',
      metadata: { purpose: 'register' },
    });
  }

  async startRecovery(email: string): Promise<void> {
    const normalized = email.toLowerCase();
    const user = await this.userModel.findOne({
      email: normalized,
      emailVerified: true,
    });
    if (!user) throw new NotFoundException('No account for this email.');
    const code = await this.otp.issue(normalized, 'recovery');
    await this.email.sendOtpEmail(normalized, code);
    await this.audit.log({ userId: user._id, action: 'auth.recovery_started' });
  }

  async verifyOtp(
    email: string,
    code: string,
    purpose: OtpPurpose,
  ): Promise<string> {
    const normalized = email.toLowerCase();
    const ok = await this.otp.verify(normalized, purpose, code);
    if (!ok) throw new UnauthorizedException('Invalid or expired code.');
    const user = await this.userModel.findOne({ email: normalized });
    if (!user) throw new UnauthorizedException();
    if (purpose === 'register' && !user.emailVerified) {
      user.emailVerified = true;
      await user.save();
      await this.audit.log({ userId: user._id, action: 'auth.registered' });
    }
    if (purpose === 'recovery' && !user.emailVerified) {
      throw new UnauthorizedException();
    }
    return this.sessions.create(user._id, 'pending_passkey');
  }
}
```

`server/src/auth/auth.controller.ts`:
```ts
import { Body, Controller, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { EmailDto, VerifyOtpDto } from './dto';
import { setSessionCookie } from './cookie';

@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private config: ConfigService,
  ) {}

  @Post('register')
  async register(@Body() dto: EmailDto) {
    await this.auth.startRegistration(dto.email);
    return { message: 'Verification code sent.' };
  }

  @Post('recover')
  async recover(@Body() dto: EmailDto) {
    await this.auth.startRecovery(dto.email);
    return { message: 'Verification code sent.' };
  }

  @Post('verify-otp')
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = await this.auth.verifyOtp(dto.email, dto.code, dto.purpose);
    setSessionCookie(res, this.config, token);
    return { scope: 'pending_passkey' };
  }
}
```

`server/src/auth/auth.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { SessionService } from './session.service';
import { AuthGuard } from './auth.guard';
import { EmailModule } from '../email/email.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [EmailModule, AuditModule],
  controllers: [AuthController],
  providers: [AuthService, OtpService, SessionService, AuthGuard],
  exports: [SessionService, AuthGuard],
})
export class AuthModule {}
```

Add `AuthModule` to `server/src/app.module.ts` imports.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --workspace server -- auth-register`
Expected: PASS (all 5 tests).

- [ ] **Step 6: Commit**

```bash
git add server/src/auth/ server/src/app.module.ts server/test/
git commit -m "feat(server): add registration, recovery, and OTP verification endpoints"
```

---

### Task 9: WebauthnService + passkey registration ceremony endpoints

**Files:**
- Create: `server/src/auth/webauthn.service.ts`
- Modify: `server/src/auth/auth.controller.ts` (add passkey endpoints), `server/src/auth/auth.module.ts` (provide + export WebauthnService)
- Test: `server/test/passkey-registration.e2e.spec.ts`

**Interfaces:**
- Consumes: `Credential`, `WebauthnChallenge`, `User` models; `SessionService.upgrade`; `AuditLogService`; env `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`, `WEBAUTHN_RP_NAME`.
- Produces:
  - `WebauthnService.registrationOptions(userId: string, email: string): Promise<PublicKeyCredentialCreationOptionsJSON>` — persists the challenge (5 min TTL, one per user).
  - `WebauthnService.verifyRegistration(userId: string, response: RegistrationResponseJSON, deviceLabel: string): Promise<CredentialDocument>`.
  - `WebauthnService.authenticationOptions(email: string): Promise<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }>` (used in Task 10).
  - `WebauthnService.verifyAuthentication(challengeId: string, response: AuthenticationResponseJSON): Promise<Types.ObjectId>` (used in Task 10).
  - `POST /api/auth/passkey/options` (auth, pending allowed) → creation options JSON.
  - `POST /api/auth/passkey/verify` body `{ response, deviceLabel? }` (auth, pending allowed) → `PasskeySummary`; upgrades a pending session to full; audits `passkey.added`.

- [ ] **Step 1: Write the failing e2e test**

`server/test/passkey-registration.e2e.spec.ts`:
```ts
import request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { Session } from '../src/database/schemas/session.schema';
import { Credential } from '../src/database/schemas/credential.schema';

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(async () => ({
    challenge: 'test-challenge',
    rp: { name: 'Finance Tracker', id: 'localhost' },
  })),
  verifyRegistrationResponse: jest.fn(async () => ({
    verified: true,
    registrationInfo: {
      credential: {
        id: 'cred-abc',
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
      },
    },
  })),
  generateAuthenticationOptions: jest.fn(async () => ({
    challenge: 'test-challenge',
  })),
  verifyAuthenticationResponse: jest.fn(async () => ({
    verified: true,
    authenticationInfo: { newCounter: 1 },
  })),
}));

describe('passkey registration ceremony', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let cookie: string;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    // Register through the real flow to obtain a pending session cookie.
    await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'pk@user.com' });
    const code = ctx.sentCodes.get('pk@user.com')!;
    const res = await request(ctx.app.getHttpServer())
      .post('/api/auth/verify-otp')
      .send({ email: 'pk@user.com', code, purpose: 'register' });
    cookie = res.headers['set-cookie'][0].split(';')[0];
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('rejects the ceremony without a session', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/auth/passkey/options')
      .expect(401);
  });

  it('returns creation options for a pending session', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/auth/passkey/options')
      .set('Cookie', cookie)
      .expect(201);
    expect(res.body.challenge).toBe('test-challenge');
  });

  it('verifies, stores the credential, and upgrades the session', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/auth/passkey/verify')
      .set('Cookie', cookie)
      .send({ response: { id: 'cred-abc' }, deviceLabel: 'Test Device' })
      .expect(201);
    expect(res.body.deviceLabel).toBe('Test Device');

    const credModel: Model<Credential> = ctx.app.get(
      getModelToken(Credential.name),
    );
    const cred = await credModel.findOne({ credentialId: 'cred-abc' });
    expect(cred).not.toBeNull();

    const sessionModel: Model<Session> = ctx.app.get(
      getModelToken(Session.name),
    );
    const session = await sessionModel.findOne().sort({ createdAt: -1 });
    expect(session!.scope).toBe('full');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace server -- passkey-registration`
Expected: FAIL — 404 on `/api/auth/passkey/options`.

- [ ] **Step 3: Implement WebauthnService**

`server/src/auth/webauthn.service.ts`:
```ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import {
  Credential,
  CredentialDocument,
} from '../database/schemas/credential.schema';
import { WebauthnChallenge } from '../database/schemas/webauthn-challenge.schema';
import { User } from '../database/schemas/user.schema';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class WebauthnService {
  private rpId: string;
  private rpName: string;
  private origin: string;

  constructor(
    config: ConfigService,
    @InjectModel(Credential.name) private credModel: Model<Credential>,
    @InjectModel(WebauthnChallenge.name)
    private challengeModel: Model<WebauthnChallenge>,
    @InjectModel(User.name) private userModel: Model<User>,
  ) {
    this.rpId = config.get('WEBAUTHN_RP_ID', 'localhost');
    this.rpName = config.get('WEBAUTHN_RP_NAME', 'Finance Tracker');
    this.origin = config.get('WEBAUTHN_ORIGIN', 'http://localhost:5173');
  }

  async registrationOptions(
    userId: string,
    email: string,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const uid = new Types.ObjectId(userId);
    const creds = await this.credModel.find({ userId: uid });
    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpId,
      userName: email,
      attestationType: 'none',
      excludeCredentials: creds.map((c) => ({ id: c.credentialId })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });
    await this.challengeModel.findOneAndUpdate(
      { userId: uid, type: 'registration' },
      {
        challenge: options.challenge,
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      },
      { upsert: true },
    );
    return options;
  }

  async verifyRegistration(
    userId: string,
    response: RegistrationResponseJSON,
    deviceLabel: string,
  ): Promise<CredentialDocument> {
    const uid = new Types.ObjectId(userId);
    const challengeDoc = await this.challengeModel.findOne({
      userId: uid,
      type: 'registration',
      expiresAt: { $gt: new Date() },
    });
    if (!challengeDoc) {
      throw new BadRequestException('No pending passkey challenge.');
    }
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge: challengeDoc.challenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpId,
    });
    if (!result.verified || !result.registrationInfo) {
      throw new UnauthorizedException('Passkey verification failed.');
    }
    const { credential } = result.registrationInfo;
    const created = await this.credModel.create({
      userId: uid,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      deviceLabel,
    });
    await challengeDoc.deleteOne();
    return created;
  }

  async authenticationOptions(email: string): Promise<{
    challengeId: string;
    options: PublicKeyCredentialRequestOptionsJSON;
  }> {
    const user = await this.userModel.findOne({
      email: email.toLowerCase(),
      emailVerified: true,
    });
    if (!user) throw new NotFoundException('No account for this email.');
    const creds = await this.credModel.find({ userId: user._id });
    if (creds.length === 0) {
      throw new NotFoundException(
        'No passkeys registered. Use account recovery.',
      );
    }
    const options = await generateAuthenticationOptions({
      rpID: this.rpId,
      userVerification: 'preferred',
      allowCredentials: creds.map((c) => ({ id: c.credentialId })),
    });
    const doc = await this.challengeModel.create({
      challenge: options.challenge,
      userId: user._id,
      type: 'authentication',
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    });
    return { challengeId: doc._id.toHexString(), options };
  }

  async verifyAuthentication(
    challengeId: string,
    response: AuthenticationResponseJSON,
  ): Promise<Types.ObjectId> {
    if (!Types.ObjectId.isValid(challengeId)) {
      throw new UnauthorizedException('Login challenge expired.');
    }
    const challengeDoc = await this.challengeModel.findOne({
      _id: new Types.ObjectId(challengeId),
      type: 'authentication',
      expiresAt: { $gt: new Date() },
    });
    if (!challengeDoc || !challengeDoc.userId) {
      throw new UnauthorizedException('Login challenge expired.');
    }
    const cred = await this.credModel.findOne({
      credentialId: response.id,
      userId: challengeDoc.userId,
    });
    if (!cred) throw new UnauthorizedException('Unknown passkey.');
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challengeDoc.challenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpId,
      credential: {
        id: cred.credentialId,
        publicKey: new Uint8Array(cred.publicKey),
        counter: cred.counter,
      },
    });
    if (!result.verified) {
      throw new UnauthorizedException('Passkey verification failed.');
    }
    cred.counter = result.authenticationInfo.newCounter;
    await cred.save();
    await challengeDoc.deleteOne();
    return challengeDoc.userId;
  }
}
```

- [ ] **Step 4: Add ceremony endpoints to AuthController and wire the module**

Add to `server/src/auth/auth.controller.ts` (new imports plus two handlers):
```ts
import { Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { AuthGuard, AllowPendingSession } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { RequestUser, SessionService } from './session.service';
import { WebauthnService } from './webauthn.service';
import { AuditLogService } from '../audit/audit.service';
import { PasskeyVerifyDto } from './dto';
```

Extend the constructor:
```ts
  constructor(
    private auth: AuthService,
    private config: ConfigService,
    private webauthn: WebauthnService,
    private sessions: SessionService,
    private audit: AuditLogService,
  ) {}
```

New handlers:
```ts
  @Post('passkey/options')
  @UseGuards(AuthGuard)
  @AllowPendingSession()
  async passkeyOptions(@CurrentUser() user: RequestUser) {
    return this.webauthn.registrationOptions(user.userId, user.email);
  }

  @Post('passkey/verify')
  @UseGuards(AuthGuard)
  @AllowPendingSession()
  async passkeyVerify(
    @CurrentUser() user: RequestUser,
    @Body() dto: PasskeyVerifyDto,
  ) {
    const cred = await this.webauthn.verifyRegistration(
      user.userId,
      dto.response as unknown as RegistrationResponseJSON,
      dto.deviceLabel ?? 'Passkey',
    );
    if (user.scope === 'pending_passkey') {
      await this.sessions.upgrade(user.sessionId);
    }
    await this.audit.log({
      userId: user.userId,
      action: 'passkey.added',
      entityType: 'Credential',
      entityId: cred.credentialId,
      metadata: { deviceLabel: cred.deviceLabel },
    });
    return {
      id: cred._id.toHexString(),
      deviceLabel: cred.deviceLabel,
      createdAt: cred.createdAt.toISOString(),
    };
  }
```

In `server/src/auth/auth.module.ts`, add `WebauthnService` to `providers` and `exports`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test --workspace server -- passkey-registration`
Expected: PASS (3 tests). Then run the full suite: `npm test --workspace server` — all green.

- [ ] **Step 6: Commit**

```bash
git add server/src/auth/ server/test/passkey-registration.e2e.spec.ts
git commit -m "feat(server): add WebAuthn passkey registration ceremony with session upgrade"
```

---

### Task 10: Login, logout, and me endpoints

**Files:**
- Modify: `server/src/auth/auth.controller.ts`
- Test: `server/test/login.e2e.spec.ts`

**Interfaces:**
- Consumes: `WebauthnService.authenticationOptions` / `verifyAuthentication`, `SessionService`, cookie helpers, `AuditLogService`.
- Produces:
  - `POST /api/auth/login/options` body `{ email }` → 201 `{ challengeId, options }`; 404 if no verified user or no passkeys.
  - `POST /api/auth/login/verify` body `{ challengeId, response }` → 201 `{ ok: true }` + full-scope `sid` cookie; audits `auth.login`.
  - `POST /api/auth/logout` (auth, pending allowed) → destroys session, clears cookie, audits `auth.logout`.
  - `GET /api/auth/me` (auth, full only) → `AuthUser` (`{ id, email }`).

- [ ] **Step 1: Write the failing e2e test**

`server/test/login.e2e.spec.ts`:
```ts
import request from 'supertest';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(async () => ({
    challenge: 'test-challenge',
  })),
  verifyRegistrationResponse: jest.fn(async () => ({
    verified: true,
    registrationInfo: {
      credential: {
        id: 'cred-login',
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
      },
    },
  })),
  generateAuthenticationOptions: jest.fn(async () => ({
    challenge: 'test-challenge',
  })),
  verifyAuthenticationResponse: jest.fn(async () => ({
    verified: true,
    authenticationInfo: { newCounter: 1 },
  })),
}));

async function registerWithPasskey(ctx: TestCtx, email: string) {
  const server = ctx.app.getHttpServer();
  await request(server).post('/api/auth/register').send({ email });
  const code = ctx.sentCodes.get(email)!;
  const otpRes = await request(server)
    .post('/api/auth/verify-otp')
    .send({ email, code, purpose: 'register' });
  const pendingCookie = otpRes.headers['set-cookie'][0].split(';')[0];
  await request(server)
    .post('/api/auth/passkey/options')
    .set('Cookie', pendingCookie);
  await request(server)
    .post('/api/auth/passkey/verify')
    .set('Cookie', pendingCookie)
    .send({ response: { id: 'cred-login' }, deviceLabel: 'Test' });
  return pendingCookie; // now upgraded to full scope
}

describe('login / logout / me', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    await registerWithPasskey(ctx, 'login@user.com');
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('logs in with a passkey and reaches /me', async () => {
    const server = ctx.app.getHttpServer();
    const optRes = await request(server)
      .post('/api/auth/login/options')
      .send({ email: 'login@user.com' })
      .expect(201);
    expect(optRes.body.challengeId).toBeDefined();

    const verifyRes = await request(server)
      .post('/api/auth/login/verify')
      .send({
        challengeId: optRes.body.challengeId,
        response: { id: 'cred-login' },
      })
      .expect(201);
    const cookie = verifyRes.headers['set-cookie'][0].split(';')[0];

    const me = await request(server)
      .get('/api/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(me.body).toEqual({ id: expect.any(String), email: 'login@user.com' });
  });

  it('404s login options for an unknown email', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/auth/login/options')
      .send({ email: 'nobody@user.com' })
      .expect(404);
  });

  it('logout destroys the session', async () => {
    const server = ctx.app.getHttpServer();
    const optRes = await request(server)
      .post('/api/auth/login/options')
      .send({ email: 'login@user.com' });
    const verifyRes = await request(server)
      .post('/api/auth/login/verify')
      .send({
        challengeId: optRes.body.challengeId,
        response: { id: 'cred-login' },
      });
    const cookie = verifyRes.headers['set-cookie'][0].split(';')[0];

    await request(server).post('/api/auth/logout').set('Cookie', cookie).expect(201);
    await request(server).get('/api/auth/me').set('Cookie', cookie).expect(401);
  });

  it('401s /me without a cookie', async () => {
    await request(ctx.app.getHttpServer()).get('/api/auth/me').expect(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace server -- login`
Expected: FAIL — 404 on `/api/auth/login/options`.

- [ ] **Step 3: Add the endpoints**

Add to `server/src/auth/auth.controller.ts` (extend imports with `Get`, `Req`, `clearSessionCookie`, `EmailDto` reuse, `LoginVerifyDto`, `AuthenticationResponseJSON` type, and `AuthUser` from `@finance/shared`; add `Request` from express):
```ts
  @Post('login/options')
  async loginOptions(@Body() dto: EmailDto) {
    return this.webauthn.authenticationOptions(dto.email);
  }

  @Post('login/verify')
  async loginVerify(
    @Body() dto: LoginVerifyDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = await this.webauthn.verifyAuthentication(
      dto.challengeId,
      dto.response as unknown as AuthenticationResponseJSON,
    );
    const token = await this.sessions.create(userId, 'full');
    setSessionCookie(res, this.config, token);
    await this.audit.log({ userId, action: 'auth.login' });
    return { ok: true };
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  @AllowPendingSession()
  async logout(
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = (req.cookies as Record<string, string>).sid;
    await this.sessions.destroy(token);
    clearSessionCookie(res);
    await this.audit.log({ userId: user.userId, action: 'auth.logout' });
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: RequestUser): AuthUser {
    return { id: user.userId, email: user.email };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace server -- login`
Expected: PASS (4 tests). Then the full suite: `npm test --workspace server` — all green.

- [ ] **Step 5: Commit**

```bash
git add server/src/auth/auth.controller.ts server/test/login.e2e.spec.ts
git commit -m "feat(server): add passkey login, logout, and me endpoints"
```

---

### Task 11: Passkey management + audit log endpoints

**Files:**
- Create: `server/src/passkeys/passkeys.module.ts`, `server/src/passkeys/passkeys.controller.ts`, `server/src/audit/audit.controller.ts`
- Modify: `server/src/audit/audit.module.ts` (add controller + import AuthModule), `server/src/app.module.ts` (import PasskeysModule)
- Test: `server/test/passkeys.e2e.spec.ts`

**Interfaces:**
- Consumes: `Credential` model, `AuthGuard`, `CurrentUser`, `AuditLogService.list`, `SessionService` (via AuthModule import).
- Produces:
  - `GET /api/passkeys` (auth) → `PasskeySummary[]` newest-first.
  - `DELETE /api/passkeys/:id` (auth) → `{ ok: true }`; 400 when it is the last passkey; 404 when not found/not owned; audits `passkey.removed`. (Adding a passkey reuses `POST /api/auth/passkey/options|verify` from Task 9 — full sessions are accepted there.)
  - `GET /api/audit-log?page=1&pageSize=20` (auth) → `{ items, total }` (pageSize capped at 100).

- [ ] **Step 1: Write the failing e2e test**

`server/test/passkeys.e2e.spec.ts`:
```ts
import request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { Credential } from '../src/database/schemas/credential.schema';
import { User } from '../src/database/schemas/user.schema';

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(async () => ({
    challenge: 'test-challenge',
  })),
  verifyRegistrationResponse: jest.fn(async () => ({
    verified: true,
    registrationInfo: {
      credential: {
        id: 'cred-mgmt',
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
      },
    },
  })),
  generateAuthenticationOptions: jest.fn(async () => ({
    challenge: 'test-challenge',
  })),
  verifyAuthenticationResponse: jest.fn(async () => ({
    verified: true,
    authenticationInfo: { newCounter: 1 },
  })),
}));

describe('passkey management and audit log', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let cookie: string;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    const server = ctx.app.getHttpServer();
    await request(server).post('/api/auth/register').send({ email: 'm@u.com' });
    const code = ctx.sentCodes.get('m@u.com')!;
    const otpRes = await request(server)
      .post('/api/auth/verify-otp')
      .send({ email: 'm@u.com', code, purpose: 'register' });
    cookie = otpRes.headers['set-cookie'][0].split(';')[0];
    await request(server).post('/api/auth/passkey/options').set('Cookie', cookie);
    await request(server)
      .post('/api/auth/passkey/verify')
      .set('Cookie', cookie)
      .send({ response: { id: 'cred-mgmt' }, deviceLabel: 'Primary' });
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('lists passkeys', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/passkeys')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].deviceLabel).toBe('Primary');
  });

  it('refuses to remove the last passkey', async () => {
    const list = await request(ctx.app.getHttpServer())
      .get('/api/passkeys')
      .set('Cookie', cookie);
    await request(ctx.app.getHttpServer())
      .delete(`/api/passkeys/${list.body[0].id}`)
      .set('Cookie', cookie)
      .expect(400);
  });

  it('removes a non-last passkey and audits it', async () => {
    const credModel: Model<Credential> = ctx.app.get(
      getModelToken(Credential.name),
    );
    const userModel: Model<User> = ctx.app.get(getModelToken(User.name));
    const user = await userModel.findOne({ email: 'm@u.com' });
    const extra = await credModel.create({
      userId: user!._id,
      credentialId: 'cred-extra',
      publicKey: Buffer.from([9]),
      counter: 0,
      deviceLabel: 'Old Phone',
    });

    await request(ctx.app.getHttpServer())
      .delete(`/api/passkeys/${extra._id.toHexString()}`)
      .set('Cookie', cookie)
      .expect(200);

    const audit = await request(ctx.app.getHttpServer())
      .get('/api/audit-log?page=1&pageSize=10')
      .set('Cookie', cookie)
      .expect(200);
    expect(audit.body.items[0].action).toBe('passkey.removed');
    expect(audit.body.total).toBeGreaterThanOrEqual(3);
  });

  it('404s when deleting another users passkey id', async () => {
    await request(ctx.app.getHttpServer())
      .delete(`/api/passkeys/${new Types.ObjectId().toHexString()}`)
      .set('Cookie', cookie)
      .expect(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace server -- passkeys`
Expected: FAIL — 404 on `/api/passkeys`.

- [ ] **Step 3: Implement the controllers and modules**

`server/src/passkeys/passkeys.controller.ts`:
```ts
import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PasskeySummary } from '@finance/shared';
import { Credential } from '../database/schemas/credential.schema';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/session.service';
import { AuditLogService } from '../audit/audit.service';

@Controller('passkeys')
@UseGuards(AuthGuard)
export class PasskeysController {
  constructor(
    @InjectModel(Credential.name) private credModel: Model<Credential>,
    private audit: AuditLogService,
  ) {}

  @Get()
  async list(@CurrentUser() user: RequestUser): Promise<PasskeySummary[]> {
    const creds = await this.credModel
      .find({ userId: new Types.ObjectId(user.userId) })
      .sort({ createdAt: -1 });
    return creds.map((c) => ({
      id: c._id.toHexString(),
      deviceLabel: c.deviceLabel,
      createdAt: c.createdAt.toISOString(),
    }));
  }

  @Delete(':id')
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const uid = new Types.ObjectId(user.userId);
    const count = await this.credModel.countDocuments({ userId: uid });
    if (count <= 1) {
      throw new BadRequestException('Cannot remove your last passkey.');
    }
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const cred = await this.credModel.findOneAndDelete({
      _id: new Types.ObjectId(id),
      userId: uid,
    });
    if (!cred) throw new NotFoundException();
    await this.audit.log({
      userId: user.userId,
      action: 'passkey.removed',
      entityType: 'Credential',
      entityId: cred.credentialId,
      metadata: { deviceLabel: cred.deviceLabel },
    });
    return { ok: true };
  }
}
```

`server/src/passkeys/passkeys.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { PasskeysController } from './passkeys.controller';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [PasskeysController],
})
export class PasskeysModule {}
```

`server/src/audit/audit.controller.ts`:
```ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/session.service';
import { AuditLogService } from './audit.service';

@Controller('audit-log')
@UseGuards(AuthGuard)
export class AuditController {
  constructor(private audit: AuditLogService) {}

  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
    return this.audit.list(user.userId, p, ps);
  }
}
```

Update `server/src/audit/audit.module.ts`:
```ts
import { forwardRef, Module } from '@nestjs/common';
import { AuditLogService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [AuditController],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
```

Note: `forwardRef` is required because AuthModule imports AuditModule (for logging) while AuditModule imports AuthModule (for the guard). Mirror it in `auth.module.ts`: `imports: [EmailModule, forwardRef(() => AuditModule)]`.

Add `PasskeysModule` to `server/src/app.module.ts` imports.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace server`
Expected: full suite PASS (health, schemas, audit, email, otp, session, auth-register, passkey-registration, login, passkeys).

- [ ] **Step 5: Commit**

```bash
git add server/src/passkeys/ server/src/audit/ server/src/auth/auth.module.ts server/src/app.module.ts server/test/passkeys.e2e.spec.ts
git commit -m "feat(server): add passkey management and audit log endpoints"
```

---

### Task 12: Client scaffold with API helper and auth context

**Files:**
- Create: `client/package.json`, `client/tsconfig.json`, `client/vite.config.ts`, `client/index.html`
- Create: `client/src/main.tsx`, `client/src/App.tsx`, `client/src/api.ts`, `client/src/auth-context.tsx`
- Test: `client/src/api.spec.ts`

**Interfaces:**
- Consumes: server REST API under `/api` (proxied by Vite dev server to `localhost:3000`); `AuthUser` type from `@finance/shared`.
- Produces:
  - `api<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T>` — JSON fetch wrapper, `credentials: 'include'`, throws `ApiError { status, message }` on non-2xx.
  - `AuthProvider` React context and `useAuth(): { user: AuthUser | null; loading: boolean; refresh: () => Promise<void> }`.
  - `App` with routes: `/register`, `/register/verify`, `/register/passkey`, `/login`, `/recover`, `/dashboard`, `/settings`, `/` → redirect to `/dashboard`. Page components arrive in Tasks 13-14; this task registers placeholder `<div>` elements so the router compiles.

- [ ] **Step 1: Create the package and config files**

`client/package.json`:
```json
{
  "name": "@finance/client",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "@finance/shared": "*",
    "@simplewebauthn/browser": "^13.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.1.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.7.0",
    "vite": "^7.0.0",
    "vitest": "^3.0.0"
  }
}
```

`client/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vitest/globals"]
  },
  "include": ["src"]
}
```

`client/vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
});
```

Note: the `test` key requires `/// <reference types="vitest/config" />` at the top of `vite.config.ts` — add that line first if tsc complains.

`client/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Finance Tracker</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Write the failing api helper test**

`client/src/api.spec.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, ApiError } from './api';

describe('api', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('GETs JSON with credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: '1', email: 'a@b.com' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await api<{ id: string }>('/auth/me');
    expect(result.id).toBe('1');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/me',
      expect.objectContaining({ credentials: 'include', method: 'GET' }),
    );
  });

  it('POSTs a JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await api('/auth/register', { method: 'POST', body: { email: 'a@b.com' } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(JSON.stringify({ email: 'a@b.com' }));
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('throws ApiError with the server message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Invalid or expired code.' }), {
          status: 401,
        }),
      ),
    );
    await expect(api('/auth/verify-otp', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 401,
      message: 'Invalid or expired code.',
    });
    await expect(api('/x')).rejects.toBeInstanceOf(ApiError);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm install` (root, to link the new workspace), then `npm test --workspace client`
Expected: FAIL — cannot find module `./api`.

- [ ] **Step 4: Implement api.ts, auth context, App shell**

`client/src/api.ts`:
```ts
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T = unknown>(
  path: string,
  options?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: options?.method ?? 'GET',
    credentials: 'include',
    headers: options?.body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = (await res.json()) as { message?: string | string[] };
      if (data.message) {
        message = Array.isArray(data.message) ? data.message[0] : data.message;
      }
    } catch {
      // non-JSON error body; keep statusText
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
```

`client/src/auth-context.tsx`:
```tsx
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { AuthUser } from '@finance/shared';
import { api } from './api';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setUser(await api<AuthUser>('/auth/me'));
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ user, loading, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
```

`client/src/App.tsx`:
```tsx
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth-context';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/register" element={<div>register</div>} />
          <Route path="/register/verify" element={<div>verify</div>} />
          <Route path="/register/passkey" element={<div>passkey</div>} />
          <Route path="/login" element={<div>login</div>} />
          <Route path="/recover" element={<div>recover</div>} />
          <Route path="/dashboard" element={<div>dashboard</div>} />
          <Route path="/settings" element={<div>settings</div>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
```

`client/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 5: Run tests and dev build**

Run: `npm test --workspace client`
Expected: PASS (3 tests).
Run: `npm run build --workspace client`
Expected: builds without type errors (requires `npm run build:shared` to have been run).

- [ ] **Step 6: Commit**

```bash
git add client/ package-lock.json
git commit -m "feat(client): scaffold Vite React app with api helper and auth context"
```

---

### Task 13: Client auth pages (register, verify, passkey, login, recover)

**Files:**
- Create: `client/src/pages/RegisterPage.tsx`, `client/src/pages/VerifyOtpPage.tsx`, `client/src/pages/PasskeyPage.tsx`, `client/src/pages/LoginPage.tsx`, `client/src/pages/RecoverPage.tsx`
- Modify: `client/src/App.tsx` (swap placeholders for real pages)

**Interfaces:**
- Consumes: `api`, `useAuth().refresh`, `startRegistration` / `startAuthentication` from `@simplewebauthn/browser`; server endpoints from Tasks 8-10.
- Produces: working browser flows. `VerifyOtpPage` reads `location.state as { email: string; purpose: 'register' | 'recovery' }` and is shared by registration and recovery.

- [ ] **Step 1: Write the pages**

`client/src/pages/RegisterPage.tsx`:
```tsx
import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/register', { method: 'POST', body: { email } });
      navigate('/register/verify', { state: { email, purpose: 'register' } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Create account</h1>
      <form onSubmit={onSubmit}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={busy}>
          Send verification code
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      <p>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </main>
  );
}
```

`client/src/pages/VerifyOtpPage.tsx`:
```tsx
import { FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';

interface VerifyState {
  email: string;
  purpose: 'register' | 'recovery';
}

export default function VerifyOtpPage() {
  const location = useLocation();
  const state = location.state as VerifyState | null;
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  if (!state?.email) return <Navigate to="/register" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/verify-otp', {
        method: 'POST',
        body: { email: state!.email, code, purpose: state!.purpose },
      });
      navigate('/register/passkey');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Check your email</h1>
      <p>We sent a 6-digit code to {state.email}.</p>
      <form onSubmit={onSubmit}>
        <label>
          Code
          <input
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={busy}>
          Verify
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
```

`client/src/pages/PasskeyPage.tsx`:
```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { api, ApiError } from '../api';
import { useAuth } from '../auth-context';

export default function PasskeyPage() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useAuth();

  async function createPasskey() {
    setBusy(true);
    setError('');
    try {
      const options = await api<PublicKeyCredentialCreationOptionsJSON>(
        '/auth/passkey/options',
        { method: 'POST' },
      );
      const response = await startRegistration({ optionsJSON: options });
      await api('/auth/passkey/verify', {
        method: 'POST',
        body: { response, deviceLabel: navigator.platform || 'Passkey' },
      });
      await refresh();
      navigate('/dashboard');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Passkey creation was cancelled or failed.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Set up your passkey</h1>
      <p>Your device will prompt you to create a passkey for this site.</p>
      <button onClick={createPasskey} disabled={busy}>
        Create passkey
      </button>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
```

`client/src/pages/LoginPage.tsx`:
```tsx
import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { startAuthentication } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { api, ApiError } from '../api';
import { useAuth } from '../auth-context';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useAuth();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { challengeId, options } = await api<{
        challengeId: string;
        options: PublicKeyCredentialRequestOptionsJSON;
      }>('/auth/login/options', { method: 'POST', body: { email } });
      const response = await startAuthentication({ optionsJSON: options });
      await api('/auth/login/verify', {
        method: 'POST',
        body: { challengeId, response },
      });
      await refresh();
      navigate('/dashboard');
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Login was cancelled or failed.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Log in</h1>
      <form onSubmit={onSubmit}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={busy}>
          Continue with passkey
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      <p>
        <Link to="/recover">Lost your passkeys?</Link> ·{' '}
        <Link to="/register">Create an account</Link>
      </p>
    </main>
  );
}
```

`client/src/pages/RecoverPage.tsx`:
```tsx
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';

export default function RecoverPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/recover', { method: 'POST', body: { email } });
      navigate('/register/verify', { state: { email, purpose: 'recovery' } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Recover your account</h1>
      <p>We will email you a code, then you can register a new passkey.</p>
      <form onSubmit={onSubmit}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={busy}>
          Send recovery code
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
```

Update `client/src/App.tsx` routes:
```tsx
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth-context';
import RegisterPage from './pages/RegisterPage';
import VerifyOtpPage from './pages/VerifyOtpPage';
import PasskeyPage from './pages/PasskeyPage';
import LoginPage from './pages/LoginPage';
import RecoverPage from './pages/RecoverPage';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/register/verify" element={<VerifyOtpPage />} />
          <Route path="/register/passkey" element={<PasskeyPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/recover" element={<RecoverPage />} />
          <Route path="/dashboard" element={<div>dashboard</div>} />
          <Route path="/settings" element={<div>settings</div>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
```

- [ ] **Step 2: Type-check and run existing tests**

Run: `npm run build --workspace client && npm test --workspace client`
Expected: build clean, api tests still PASS.

- [ ] **Step 3: Manual smoke test (requires Task 15's Mongo, or any local Mongo)**

1. Start Mongo (`docker compose up -d mongo` once Task 15 lands, or a local instance).
2. `npm run start:dev --workspace server` and `npm run dev --workspace client`.
3. Visit `http://localhost:5173/register`, register with a real email (or temporarily log the OTP server-side), enter the code, create a passkey (Chrome DevTools → WebAuthn tab → "Enable virtual authenticator environment" works without hardware).
4. Confirm you land on `/dashboard` and `document.cookie` does NOT show `sid` (httpOnly).

If Mongo is not available yet, defer this step to Task 15 Step 4 — it repeats there.

- [ ] **Step 4: Commit**

```bash
git add client/src/
git commit -m "feat(client): add registration, OTP, passkey, login, and recovery pages"
```

---

### Task 14: Protected routes, settings page, dashboard placeholder

**Files:**
- Create: `client/src/ProtectedRoute.tsx`, `client/src/pages/SettingsPage.tsx`, `client/src/pages/DashboardPage.tsx`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `useAuth`, `api`, `PasskeySummary` from `@finance/shared`, endpoints from Tasks 9-11.
- Produces: `/dashboard` and `/settings` render only for full sessions; settings lists/adds/removes passkeys and shows the audit log; header with logout. Plan 2 replaces `DashboardPage` internals.

- [ ] **Step 1: Write ProtectedRoute and pages**

`client/src/ProtectedRoute.tsx`:
```tsx
import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './auth-context';

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
```

`client/src/pages/DashboardPage.tsx`:
```tsx
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth-context';

export default function DashboardPage() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    await refresh();
    navigate('/login');
  }

  return (
    <main>
      <header>
        <h1>Dashboard</h1>
        <nav>
          <span>{user?.email}</span> <Link to="/settings">Settings</Link>{' '}
          <button onClick={logout}>Log out</button>
        </nav>
      </header>
      <p>Financial widgets arrive in Plan 2/3.</p>
    </main>
  );
}
```

`client/src/pages/SettingsPage.tsx`:
```tsx
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { PasskeySummary } from '@finance/shared';
import { api, ApiError } from '../api';

interface AuditItem {
  action: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export default function SettingsPage() {
  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([]);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setPasskeys(await api<PasskeySummary[]>('/passkeys'));
    const page = await api<{ items: AuditItem[]; total: number }>(
      '/audit-log?page=1&pageSize=20',
    );
    setAudit(page.items);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addPasskey() {
    setError('');
    try {
      const options = await api<PublicKeyCredentialCreationOptionsJSON>(
        '/auth/passkey/options',
        { method: 'POST' },
      );
      const response = await startRegistration({ optionsJSON: options });
      await api('/auth/passkey/verify', {
        method: 'POST',
        body: { response, deviceLabel: navigator.platform || 'Passkey' },
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Passkey creation failed.');
    }
  }

  async function removePasskey(id: string) {
    setError('');
    try {
      await api(`/passkeys/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove passkey.');
    }
  }

  return (
    <main>
      <h1>Settings</h1>
      <Link to="/dashboard">Back to dashboard</Link>
      {error && <p role="alert">{error}</p>}

      <section>
        <h2>Passkeys</h2>
        <ul>
          {passkeys.map((p) => (
            <li key={p.id}>
              {p.deviceLabel} — added{' '}
              {new Date(p.createdAt).toLocaleDateString()}{' '}
              <button onClick={() => removePasskey(p.id)}>Remove</button>
            </li>
          ))}
        </ul>
        <button onClick={addPasskey}>Add a passkey</button>
      </section>

      <section>
        <h2>Recent activity</h2>
        <ul>
          {audit.map((a, i) => (
            <li key={i}>
              {new Date(a.timestamp).toLocaleString()} — {a.action}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
```

Update `client/src/App.tsx` (add imports and swap the two placeholder routes):
```tsx
import ProtectedRoute from './ProtectedRoute';
import DashboardPage from './pages/DashboardPage';
import SettingsPage from './pages/SettingsPage';
// ...
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <SettingsPage />
              </ProtectedRoute>
            }
          />
```

- [ ] **Step 2: Type-check and test**

Run: `npm run build --workspace client && npm test --workspace client`
Expected: clean build, tests PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/
git commit -m "feat(client): add protected routes, settings with passkey management, dashboard shell"
```

---

### Task 15: docker-compose for dev + README

**Files:**
- Create: `docker-compose.yml`, `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: `docker compose up -d mongo` gives the dev database at `mongodb://localhost:27017/finance-tracker` with a persistent volume. Production compose (server image, nginx client, cloudflared) is deliberately deferred to Plan 3's deployment tasks.

- [ ] **Step 1: Write docker-compose.yml**

```yaml
services:
  mongo:
    image: mongo:8
    restart: unless-stopped
    ports:
      - "27017:27017"
    volumes:
      - mongo-data:/data/db

volumes:
  mongo-data:
```

- [ ] **Step 2: Write README.md**

```markdown
# Finance Tracker

Self-hosted personal finance tracker. Passwordless (WebAuthn passkeys),
NestJS + React + MongoDB, single currency (MYR).

## Development

Prereqs: Node 22+, Docker.

    cp .env.example .env        # fill in MailerSend key + from-address
    npm install
    npm run build:shared
    docker compose up -d mongo
    npm run start:dev --workspace server   # http://localhost:3000
    npm run dev --workspace client         # http://localhost:5173

The Vite dev server proxies `/api` to the NestJS server, so cookies and
WebAuthn both see a single origin (`http://localhost:5173`).

Passkeys on localhost work without HTTPS. For a passkey-less test setup, use
Chrome DevTools → WebAuthn → virtual authenticator.

## Tests

    npm test --workspace server
    npm test --workspace client

## Docs

- Spec: `docs/superpowers/specs/2026-07-12-finance-tracker-design.md`
- Plans: `docs/superpowers/plans/`
```

- [ ] **Step 3: Verify**

Run: `docker compose up -d mongo && docker compose ps`
Expected: mongo service `running`.
Run: `npm test --workspace server`
Expected: full suite PASS (uses memory server, unaffected — this is the final regression check).

- [ ] **Step 4: Full-flow manual smoke test**

With mongo, server, and client all running (README steps): register → OTP → passkey → dashboard → settings (add/remove passkey, audit list) → logout → login → recover. Use Chrome's virtual authenticator if no platform authenticator is handy.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml README.md
git commit -m "chore: add dev docker-compose (mongo) and README quickstart"
```

---

## Out of Scope for Plan 1

- Financial entities, transactions, balances → Plan 2.
- Dashboard widgets/charts, production Dockerfiles, nginx, Cloudflare Tunnel → Plan 3.
- Email reminders, amortization, multi-currency → out of scope for v1 entirely (see spec §8).
