# Admin-Gated Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registration OTPs are emailed only to a fixed `ADMIN_EMAIL` (never to the registrant), with the registrant's name and email included for the admin's out-of-band approval decision; recovery OTPs continue going to the account's own email, unchanged.

**Architecture:** Add a `name` field to registration, add an `ADMIN_EMAIL` config value, add a new `EmailService.sendRegistrationRequestEmail` method distinct from the existing `sendOtpEmail` (which recovery keeps using), and re-point `AuthService.startRegistration` to call the new method with the admin's address. No schema/route/session changes beyond that.

**Tech Stack:** NestJS (server), React + Vite (client), Mongoose, Mailgun (`mailgun.js`), Jest (server unit + e2e via `mongodb-memory-server`), class-validator DTOs.

## Global Constraints

- Money is always integer sen; dates always UTC via `server/src/common/dates.ts` — not touched by this feature, noted only because it's a repo-wide rule.
- Rebuild `shared` after any change to `shared/src` (`npm run build:shared`) — this feature does not touch `shared/src`, so this is not expected to be needed, but re-check if a task ends up touching `shared/src/index.ts`.
- `DatabaseModule` (`server/src/database/database.module.ts`) is `@Global()` and is where all Mongoose schemas are registered — do not register `User`'s schema anywhere else.
- Don't rename/reuse the `authEmail` throttler name (`server/src/auth/email-key-throttler.guard.ts`) — this plan does not touch throttling, but Task 3 modifies the DTO consumed by the throttled route, so don't change the `email` field name/shape.
- Every mutation-adjacent change should still pass existing e2e suites (`auth-register.e2e.spec.ts`, `auth-rate-limit.e2e.spec.ts`) after adaptation — these are being intentionally modified in this plan (see Task 5), not left broken.

---

### Task 1: Add `ADMIN_EMAIL` config and `name` field to the `User` schema

**Files:**
- Modify: `server/src/database/schemas/user.schema.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `User.name?: string` (optional, trimmed) property on the Mongoose schema, consumed by Task 2 (`AuthService.startRegistration`).
- Produces: `ADMIN_EMAIL` env var convention (read via `ConfigService.getOrThrow<string>('ADMIN_EMAIL')`), consumed by Task 2.

- [ ] **Step 1: Add the `name` field to the `User` schema**

Edit `server/src/database/schemas/user.schema.ts`:

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema()
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ trim: true })
  name?: string;

  @Prop({ default: false })
  emailVerified: boolean;

  @Prop({ default: () => new Date() })
  createdAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
```

- [ ] **Step 2: Add `ADMIN_EMAIL` to `.env.example`**

Edit `.env.example`, adding the line directly after `MAILGUN_FROM_EMAIL`:

```
PORT=3000
MONGODB_URI=mongodb://localhost:27017/finance-tracker?replicaSet=rs0&directConnection=true
MAILGUN_API_KEY=your-key-here
MAILGUN_DOMAIN=mg.yourdomain.com
MAILGUN_FROM_EMAIL=noreply@yourdomain.com
ADMIN_EMAIL=admin@yourdomain.com
WEBAUTHN_RP_ID=localhost
WEBAUTHN_ORIGIN=http://localhost:5173
WEBAUTHN_RP_NAME=Finance Tracker
COOKIE_SECURE=false
SESSION_TTL_DAYS=30
```

(Leave the rest of the file, including the "Production overrides" comment block below it, unchanged.)

- [ ] **Step 3: Verify the server still builds**

Run: `npm run build --workspace server`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add server/src/database/schemas/user.schema.ts .env.example
git commit -m "feat: add name field to User schema and ADMIN_EMAIL config"
```

---

### Task 2: Add `EmailService.sendRegistrationRequestEmail`

**Files:**
- Modify: `server/src/email/email.service.ts`
- Modify: `server/src/email/email.service.spec.ts`

**Interfaces:**
- Consumes: nothing new (same `ConfigService`, `mailgun.js` client already in the constructor).
- Produces: `sendRegistrationRequestEmail(adminEmail: string, code: string, registrant: { name: string; email: string }): Promise<void>`, consumed by Task 3 (`AuthService.startRegistration`).

- [ ] **Step 1: Write the failing tests**

Add to `server/src/email/email.service.spec.ts`, inside the existing `describe('EmailService', ...)` block, after the existing three `it(...)` cases (before the closing `});`):

```typescript
  it('sends a registration request to the given admin email with the registrant name/email/code', async () => {
    limitGetMock.mockResolvedValue({ limit: 3000, current: 5, period: 'monthly' });
    await service.sendRegistrationRequestEmail('admin@test.com', '654321', {
      name: 'Jane Doe',
      email: 'jane@example.com',
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0];
    expect(call[0]).toBe('mg.test.com');
    expect(call[1].to).toEqual(['admin@test.com']);
    expect(call[1].text).toContain('Jane Doe');
    expect(call[1].text).toContain('jane@example.com');
    expect(call[1].text).toContain('654321');
  });

  it('hard-stops sendRegistrationRequestEmail once the Mailgun account limit is reached', async () => {
    limitGetMock.mockResolvedValue({ limit: 3000, current: 3000, period: 'monthly' });
    await expect(
      service.sendRegistrationRequestEmail('admin@test.com', '654321', {
        name: 'Jane Doe',
        email: 'jane@example.com',
      }),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(sendMock).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest server/src/email/email.service.spec.ts --workspace server`
Expected: FAIL — `service.sendRegistrationRequestEmail is not a function`.

- [ ] **Step 3: Implement `sendRegistrationRequestEmail`**

Edit `server/src/email/email.service.ts`, adding this method after the existing `sendOtpEmail`:

```typescript
  async sendRegistrationRequestEmail(
    adminEmail: string,
    code: string,
    registrant: { name: string; email: string },
  ): Promise<void> {
    await this.checkSendLimit();
    if (process.env.NODE_ENV !== 'production') {
      console.log(
        `[dev] Registration request from ${registrant.name} <${registrant.email}>, code: ${code}`,
      );
    }
    await this.mailer.messages.create(this.domain, {
      from: `Finance Tracker <${this.from}>`,
      to: [adminEmail],
      subject: 'Finance Tracker registration request',
      text: `${registrant.name} <${registrant.email}> is requesting to register.\n\nVerification code: ${code}\n\nIt expires in 10 minutes. Share it with them only if you want to approve this registration.`,
    });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest server/src/email/email.service.spec.ts --workspace server`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add server/src/email/email.service.ts server/src/email/email.service.spec.ts
git commit -m "feat: add sendRegistrationRequestEmail for admin-gated registration"
```

---

### Task 3: Add `RegisterDto` and re-point `AuthService.startRegistration` at the admin email

**Files:**
- Modify: `server/src/auth/dto.ts`
- Modify: `server/src/auth/auth.service.ts`
- Modify: `server/src/auth/auth.controller.ts`

**Interfaces:**
- Consumes: `EmailService.sendRegistrationRequestEmail` from Task 2; `User.name` from Task 1; `ConfigService.getOrThrow` for `ADMIN_EMAIL` from Task 1.
- Produces: `RegisterDto { name: string; email: string }`, consumed by Task 4 (frontend) and Task 5 (e2e tests). `AuthService.startRegistration(name: string, email: string): Promise<void>` (signature change from the current `startRegistration(email: string)`).

- [ ] **Step 1: Add `RegisterDto` to `server/src/auth/dto.ts`**

Edit `server/src/auth/dto.ts` — add `MinLength` to the `class-validator` import and add the new class after `EmailDto`:

```typescript
import {
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MinLength,
} from 'class-validator';

export class EmailDto {
  @IsEmail()
  email: string;
}

export class RegisterDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsEmail()
  email: string;
}
```

(Leave `VerifyOtpDto`, `PasskeyVerifyDto`, `LoginVerifyDto` unchanged below.)

- [ ] **Step 2: Update `AuthService.startRegistration` to take a name and email the admin**

Edit `server/src/auth/auth.service.ts`. Add `ConfigService` to the imports and constructor, and change `startRegistration`:

```typescript
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../database/schemas/user.schema';
import { OtpPurpose } from '../database/schemas/otp-code.schema';
import { OtpService } from './otp.service';
import { SessionService } from '../auth-guard/session.service';
import { EmailService } from '../email/email.service';
import { AuditLogService } from '../audit/audit.service';

@Injectable()
export class AuthService {
  private readonly adminEmail: string;

  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    private otp: OtpService,
    private email: EmailService,
    private sessions: SessionService,
    private audit: AuditLogService,
    private config: ConfigService,
  ) {
    this.adminEmail = this.config.getOrThrow<string>('ADMIN_EMAIL');
  }

  async startRegistration(name: string, email: string): Promise<void> {
    const normalized = email.toLowerCase();
    const existing = await this.userModel.findOne({ email: normalized });
    if (existing?.emailVerified) {
      throw new ConflictException('Account already exists. Log in instead.');
    }
    const user =
      existing ??
      (await this.userModel.create({
        email: normalized,
        name,
        emailVerified: false,
      }));
    if (existing && existing.name !== name) {
      existing.name = name;
      await existing.save();
    }
    const code = await this.otp.issue(normalized, 'register');
    await this.email.sendRegistrationRequestEmail(this.adminEmail, code, {
      name,
      email: normalized,
    });
    await this.audit.log({
      userId: user._id,
      action: 'auth.otp_requested',
      metadata: { purpose: 'register', name },
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

- [ ] **Step 3: Update `AuthController.register` to use `RegisterDto`**

Edit `server/src/auth/auth.controller.ts`. Change the import line and the `register` handler:

```typescript
import { EmailDto, RegisterDto, VerifyOtpDto, PasskeyVerifyDto, LoginVerifyDto } from './dto';
```

```typescript
  @Post('register')
  @UseGuards(EmailKeyThrottlerGuard)
  @Throttle({ [AUTH_EMAIL_THROTTLER_NAME]: { limit: 5, ttl: 3_600_000 } })
  async register(@Body() dto: RegisterDto) {
    await this.auth.startRegistration(dto.name, dto.email);
    return { message: 'Verification code sent.' };
  }
```

(Leave `recover` using `EmailDto` unchanged.)

- [ ] **Step 4: Verify the server builds**

Run: `npm run build --workspace server`
Expected: exits 0. (Unit/e2e tests are expected to fail until Task 5 updates them — that's addressed next.)

- [ ] **Step 5: Commit**

```bash
git add server/src/auth/dto.ts server/src/auth/auth.service.ts server/src/auth/auth.controller.ts
git commit -m "feat: route registration OTP to ADMIN_EMAIL, require registrant name"
```

---

### Task 4: Update `RegisterPage.tsx` to collect a name

**Files:**
- Modify: `client/src/pages/RegisterPage.tsx`

**Interfaces:**
- Consumes: `POST /auth/register` now expects `{ name, email }` (Task 3).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the name field and updated copy**

Replace the full contents of `client/src/pages/RegisterPage.tsx`:

```tsx
import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import AuthCard from '../components/AuthCard';
import Button from '../components/Button';
import Input from '../components/Input';

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/register', { method: 'POST', body: { name, email } });
      navigate('/register/verify', { state: { email, purpose: 'register' } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Create account">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Input
          id="name"
          label="Name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <Input
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Button type="submit" disabled={busy} className="w-full">
          Request access
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <p className="mt-4 text-xs text-muted">
        An admin will review your request and share a verification code with
        you if approved.
      </p>
      <p className="mt-4 text-xs text-muted">
        Already have an account?{' '}
        <Link to="/login" className="text-accent hover:underline">
          Log in
        </Link>
      </p>
    </AuthCard>
  );
}
```

- [ ] **Step 2: Verify the client builds**

Run: `npm run build --workspace client`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/RegisterPage.tsx
git commit -m "feat: collect registrant name on the register page"
```

---

### Task 5: Update server e2e tests for the new registration flow

**Files:**
- Modify: `server/test/utils/app.ts`
- Modify: `server/test/auth-register.e2e.spec.ts`
- Modify: `server/test/auth-rate-limit.e2e.spec.ts`

**Interfaces:**
- Consumes: `RegisterDto { name, email }` (Task 3), `EmailService.sendRegistrationRequestEmail` signature (Task 2).
- Produces: `TestCtx.sentCodes` keyed by registrant email (unchanged behavior for test convenience) and a new `TestCtx.adminEmailCalls` array recording `{ adminEmail, name, email, code }` for each registration request, for assertions.

- [ ] **Step 1: Set `ADMIN_EMAIL` and add the new fake to `createTestApp`**

Edit `server/test/utils/app.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';
import { EmailService } from '../../src/email/email.service';

export interface AdminEmailCall {
  adminEmail: string;
  code: string;
  name: string;
  email: string;
}

export interface TestCtx {
  app: INestApplication;
  sentCodes: Map<string, string>;
  adminEmailCalls: AdminEmailCall[];
}

export const TEST_ADMIN_EMAIL = 'admin@test.com';

export async function createTestApp(): Promise<TestCtx> {
  process.env.ADMIN_EMAIL = TEST_ADMIN_EMAIL;
  const sentCodes = new Map<string, string>();
  const adminEmailCalls: AdminEmailCall[] = [];
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EmailService)
    .useValue({
      sendOtpEmail: async (to: string, code: string) => {
        sentCodes.set(to, code);
      },
      sendRegistrationRequestEmail: async (
        adminEmail: string,
        code: string,
        registrant: { name: string; email: string },
      ) => {
        sentCodes.set(registrant.email, code);
        adminEmailCalls.push({ adminEmail, code, ...registrant });
      },
    })
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  // Mirror main.ts's trust proxy setting so e2e tests exercise the same
  // req.ip resolution behavior as production (X-Forwarded-For aware).
  app.set('trust proxy', true);
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return { app, sentCodes, adminEmailCalls };
}
```

- [ ] **Step 2: Update `auth-register.e2e.spec.ts` to send a name and assert admin routing**

Replace the full contents of `server/test/auth-register.e2e.spec.ts`:

```typescript
import request from 'supertest';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx, TEST_ADMIN_EMAIL } from './utils/app';

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

  it('registers: name+email -> otp routed to admin -> pending session cookie', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'Jane Doe', email: 'new@user.com' })
      .expect(201);
    const call = ctx.adminEmailCalls.find((c) => c.email === 'new@user.com');
    expect(call).toBeDefined();
    expect(call!.adminEmail).toBe(TEST_ADMIN_EMAIL);
    expect(call!.name).toBe('Jane Doe');
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
      .send({ name: 'Two User', email: 'two@user.com' })
      .expect(201);
    await request(ctx.app.getHttpServer())
      .post('/api/auth/verify-otp')
      .send({ email: 'two@user.com', code: '000000', purpose: 'register' })
      .expect(401);
  });

  it('returns 409 when registering an already-verified email', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'Jane Doe', email: 'new@user.com' })
      .expect(409);
  });

  it('recover: 201 for verified user, 404 for unknown, otp still sent to the account email', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/auth/recover')
      .send({ email: 'new@user.com' })
      .expect(201);
    expect(ctx.sentCodes.get('new@user.com')).toMatch(/^\d{6}$/);
    await request(ctx.app.getHttpServer())
      .post('/api/auth/recover')
      .send({ email: 'ghost@user.com' })
      .expect(404);
  });

  it('rejects an invalid email with 400', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'Someone', email: 'not-an-email' })
      .expect(400);
  });

  it('rejects a missing name with 400', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'no-name@user.com' })
      .expect(400);
  });
});
```

- [ ] **Step 3: Update `auth-rate-limit.e2e.spec.ts` request bodies to include `name`**

Edit `server/test/auth-rate-limit.e2e.spec.ts` — add `name: 'Rate Limit Test'` (or a per-test-appropriate name) to every `.send({ email: ... })` call on the `/api/auth/register` route (the `/api/auth/recover` calls stay `{ email }` only, unchanged). Full updated file:

```typescript
import request from 'supertest';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';

describe('register/recover rate limiting', () => {
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

  it('blocks the 6th register request within an hour for the same IP+email', async () => {
    for (let i = 0; i < 5; i++) {
      await request(ctx.app.getHttpServer())
        .post('/api/auth/register')
        .send({ name: 'Rate Limit Test', email: 'ratelimit@user.com' })
        .expect(201);
    }
    await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'Rate Limit Test', email: 'ratelimit@user.com' })
      .expect(429);
  });

  it('does not block a different email from the same client', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/auth/recover')
      .send({ email: 'ratelimit@user.com' })
      .expect(429);
    await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'Different User', email: 'different@user.com' })
      .expect(201);
  });

  // Regression test for trust proxy config (server/src/main.ts). All requests
  // in this suite originate from the same loopback socket, so the throttler's
  // IP+email tracker can only distinguish "clients" via X-Forwarded-For if the
  // app trusts the proxy chain (app.set('trust proxy', true) in test/utils/app.ts,
  // mirroring main.ts). Without that setting, req.ip would resolve to the same
  // loopback address regardless of X-Forwarded-For, and the second email below
  // would incorrectly share the first client's exhausted bucket.
  it('treats requests with distinct X-Forwarded-For client IPs as separate throttle buckets', async () => {
    const email = 'xff-rate-limit@user.com';
    for (let i = 0; i < 5; i++) {
      await request(ctx.app.getHttpServer())
        .post('/api/auth/register')
        .set('X-Forwarded-For', '203.0.113.10')
        .send({ name: 'XFF Test', email })
        .expect(201);
    }
    await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .set('X-Forwarded-For', '203.0.113.10')
      .send({ name: 'XFF Test', email })
      .expect(429);

    // A different simulated client IP, same email, is not blocked.
    await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .set('X-Forwarded-For', '203.0.113.20')
      .send({ name: 'XFF Test', email })
      .expect(201);
  });
});
```

- [ ] **Step 4: Run the full server test suite**

Run: `npm test --workspace server`
Expected: PASS, all suites green (including `email.service.spec.ts` from Task 2 and the two e2e files above).

- [ ] **Step 5: Commit**

```bash
git add server/test/utils/app.ts server/test/auth-register.e2e.spec.ts server/test/auth-rate-limit.e2e.spec.ts
git commit -m "test: cover admin-gated registration in e2e suites"
```

---

### Task 6: Update deployment docs

**Files:**
- Modify: `docs/deployment.md`

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add `ADMIN_EMAIL` to the env var checklist**

In `docs/deployment.md`, find the line (around line 10):

```
   - `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM_EMAIL` (a verified sender domain)
```

Replace it with:

```
   - `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM_EMAIL` (a verified sender domain)
   - `ADMIN_EMAIL` (the only inbox that ever receives registration OTPs — the admin relays the code to the registrant out-of-band if approved)
```

- [ ] **Step 2: Update the smoke-test checklist line**

Find the line (around line 39):

```
- [ ] Register a new account: OTP email arrives, passkey created on a phone
```

Replace it with:

```
- [ ] Register a new account: OTP email arrives in the `ADMIN_EMAIL` inbox (not the registrant's), relay the code manually, then complete passkey creation on a phone
```

- [ ] **Step 3: Update the troubleshooting note**

Find the line (around line 55-57):

```
- **OTP emails missing**: check Mailgun dashboard for sender-domain
  verification; check the app's audit log for `auth.otp_requested`; quota
  exhaustion returns a clear 503 from `/api/auth/register`.
```

Replace it with:

```
- **OTP emails missing**: check Mailgun dashboard for sender-domain
  verification; check the app's audit log for `auth.otp_requested`; quota
  exhaustion returns a clear 503 from `/api/auth/register`. Remember
  registration OTPs go to `ADMIN_EMAIL`, not the registrant's inbox — check
  there first, not the registrant's mailbox.
```

- [ ] **Step 4: Commit**

```bash
git add docs/deployment.md
git commit -m "docs: document ADMIN_EMAIL and the admin-gated registration smoke test"
```

---

## Post-plan verification

After Task 6, run both full test suites once more to confirm nothing regressed:

Run: `npm test --workspace server && npm test --workspace client`
Expected: PASS.

Then, per `CLAUDE.md`'s "Testing new features" section, use the Playwright MCP tools against the running dev app (`npm run start:dev --workspace server` + `npm run dev --workspace client`) to drive `/register`, confirm the name field renders and submits, and confirm the dev-mode console log (`[dev] Registration request from ...`) appears in the server log instead of an OTP addressed to the registrant.
