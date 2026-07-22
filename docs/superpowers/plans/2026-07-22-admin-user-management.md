# Admin user management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user whose account email matches `ADMIN_EMAIL` can view every registered user and revoke (or restore) another user's access, without touching that user's financial data.

**Architecture:** Add a `disabled` flag to the `User` schema, enforced at the three places a user can obtain or keep a session (`SessionService.validate`, `WebauthnService.authenticationOptions`, `AuthService.startRecovery`). Expose an `isAdmin` flag on `GET /auth/me` computed from `ADMIN_EMAIL`. Add a new `admin` Nest module (guard + controller + service) with `GET /api/admin/users` and `PATCH /api/admin/users/:id`. Add a client page gated on `isAdmin`.

**Tech Stack:** NestJS (Mongoose), React + react-router-dom, Jest (server, incl. mongodb-memory-server e2e), Vitest + Testing Library (client).

## Global Constraints

- Money/date conventions in this repo don't apply to this feature (no monetary fields, no due-date math).
- Rebuild `shared` after any change to `shared/src` — `npm run build:shared` — before running client tests/build against it.
- Follow the existing per-domain module layout: guard/service/controller/module/dto files under `server/src/admin/`.
- Every e2e spec that mocks `@simplewebauthn/server` duplicates its own local `jest.mock` + `registerWithPasskey` helper (established convention in this repo — do not extract a shared helper).
- `User.email` has a `unique: true` index — never seed two users with the same email in one test file.

---

### Task 1: `disabled` field on `User` + block at session validation

**Files:**
- Modify: `server/src/database/schemas/user.schema.ts`
- Modify: `server/src/auth-guard/session.service.ts`
- Test: `server/src/auth-guard/session.service.spec.ts`

**Interfaces:**
- Produces: `User.disabled: boolean` (default `false`), consumed by Tasks 2, 4, 5. `SessionService.validate()` returns `null` for a disabled user's session — no signature change, consumed by `AuthGuard` (unchanged) and Task 2's e2e test.

- [ ] **Step 1: Write the failing test**

Add to `server/src/auth-guard/session.service.spec.ts`, inside the top-level `describe('SessionService', ...)` block, as a new sibling `it` (after the existing `'creates, validates, upgrades, and destroys a session'` test):

```ts
  it('rejects sessions for a disabled user', async () => {
    const user = await userModel.create({
      email: 'disabled@b.com',
      emailVerified: true,
    });
    const token = await service.create(user._id, 'full');
    expect(await service.validate(token)).not.toBeNull();

    await userModel.updateOne({ _id: user._id }, { disabled: true });
    expect(await service.validate(token)).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest server/src/auth-guard/session.service.spec.ts --workspace server`
Expected: FAIL — `service.validate(token)` still returns a non-null result after `disabled: true` is set (since nothing checks the field yet).

- [ ] **Step 3: Add the field and the check**

In `server/src/database/schemas/user.schema.ts`, add a new prop below `emailVerified`:

```ts
  @Prop({ default: false })
  disabled: boolean;
```

In `server/src/auth-guard/session.service.ts`, in `validate()`, right after `if (!user) return null;`:

```ts
    if (!user) return null;
    if (user.disabled) return null;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest server/src/auth-guard/session.service.spec.ts --workspace server`
Expected: PASS (all tests in the file, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add server/src/database/schemas/user.schema.ts server/src/auth-guard/session.service.ts server/src/auth-guard/session.service.spec.ts
git commit -m "feat: add disabled flag to User, enforce in SessionService.validate"
```

---

### Task 2: Block passkey login and recovery for a disabled user

**Files:**
- Modify: `server/src/auth/webauthn.service.ts`
- Modify: `server/src/auth/auth.service.ts`
- Test: `server/test/admin-disable-blocks-auth.e2e.spec.ts` (new)

**Interfaces:**
- Consumes: `User.disabled` from Task 1.
- Produces: `WebauthnService.authenticationOptions()` and `AuthService.startRecovery()` both 404 (`NotFoundException`, same message/behavior as an unknown email) for a disabled user — no signature change.

- [ ] **Step 1: Write the failing e2e test**

Create `server/test/admin-disable-blocks-auth.e2e.spec.ts`:

```ts
import request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { User } from '../src/database/schemas/user.schema';

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(async () => ({ challenge: 'test-challenge' })),
  verifyRegistrationResponse: jest.fn(async () => ({
    verified: true,
    registrationInfo: {
      credential: { id: 'cred-disabled', publicKey: new Uint8Array([1, 2, 3]), counter: 0 },
    },
  })),
  generateAuthenticationOptions: jest.fn(async () => ({ challenge: 'test-challenge' })),
  verifyAuthenticationResponse: jest.fn(async () => ({
    verified: true,
    authenticationInfo: { newCounter: 1 },
  })),
}));

async function registerWithPasskey(ctx: TestCtx, email: string) {
  const server = ctx.app.getHttpServer();
  await request(server).post('/api/auth/register').send({ name: 'Test User', email });
  const code = ctx.sentCodes.get(email)!;
  const otpRes = await request(server)
    .post('/api/auth/verify-otp')
    .send({ email, code, purpose: 'register' });
  const pendingCookie = otpRes.headers['set-cookie'][0].split(';')[0];
  await request(server).post('/api/auth/passkey/options').set('Cookie', pendingCookie);
  await request(server)
    .post('/api/auth/passkey/verify')
    .set('Cookie', pendingCookie)
    .send({ response: { id: 'cred-disabled' }, deviceLabel: 'Test' });
  return pendingCookie; // now upgraded to full scope
}

describe('disabled users are blocked from auth', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let userModel: Model<User>;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    userModel = ctx.app.get(getModelToken(User.name));
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('blocks an existing session, login/options, and recovery once disabled', async () => {
    const email = 'disabled@user.com';
    const cookie = await registerWithPasskey(ctx, email);

    await request(ctx.app.getHttpServer()).get('/api/auth/me').set('Cookie', cookie).expect(200);

    await userModel.updateOne({ email }, { disabled: true });

    await request(ctx.app.getHttpServer()).get('/api/auth/me').set('Cookie', cookie).expect(401);

    await request(ctx.app.getHttpServer())
      .post('/api/auth/login/options')
      .send({ email })
      .expect(404);

    await request(ctx.app.getHttpServer())
      .post('/api/auth/recover')
      .send({ email })
      .expect(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest server/test/admin-disable-blocks-auth.e2e.spec.ts --workspace server`
Expected: FAIL on the `login/options` and `recover` expectations (both currently return 201, not 404) — the `/me` 401 check already passes from Task 1.

- [ ] **Step 3: Add the `disabled` filter to both lookups**

In `server/src/auth/webauthn.service.ts`, in `authenticationOptions()`:

```ts
    const user = await this.userModel.findOne({
      email: email.toLowerCase(),
      emailVerified: true,
      disabled: { $ne: true },
    });
```

In `server/src/auth/auth.service.ts`, in `startRecovery()`:

```ts
    const user = await this.userModel.findOne({
      email: normalized,
      emailVerified: true,
      disabled: { $ne: true },
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest server/test/admin-disable-blocks-auth.e2e.spec.ts --workspace server`
Expected: PASS

- [ ] **Step 5: Run the full server test suite to check for regressions**

Run: `npm test --workspace server`
Expected: PASS (all suites, including `auth-register.e2e.spec.ts` and `login.e2e.spec.ts`, unaffected since neither queries a disabled user).

- [ ] **Step 6: Commit**

```bash
git add server/src/auth/webauthn.service.ts server/src/auth/auth.service.ts server/test/admin-disable-blocks-auth.e2e.spec.ts
git commit -m "feat: block passkey login and recovery for disabled users"
```

---

### Task 3: `isAdmin` on `AuthUser` / `GET /auth/me`

**Files:**
- Modify: `shared/src/index.ts`
- Modify: `server/src/auth/auth.controller.ts`
- Modify: `server/test/login.e2e.spec.ts`
- Modify: `client/src/pages/OAuthConsentPage.spec.tsx`

**Interfaces:**
- Produces: `AuthUser.isAdmin: boolean` (shared type), consumed by Task 6's `Layout`/`AdminUsersPage`. `GET /auth/me` now returns `{ id, email, isAdmin }`.

- [ ] **Step 1: Write the failing server test**

In `server/test/login.e2e.spec.ts`, update the existing assertion in `'logs in with a passkey and reaches /me'`:

```ts
    expect(me.body).toEqual({ id: expect.any(String), email: 'login@user.com', isAdmin: false });
```

Add a new `it` at the end of the `describe('login / logout / me', ...)` block (after the `'401s /me without a cookie'` test), and update the import at the top of the file to include `TEST_ADMIN_EMAIL`:

```ts
import { createTestApp, TestCtx, TEST_ADMIN_EMAIL } from './utils/app';
```

```ts
  it('flags the admin as isAdmin in /me', async () => {
    const cookie = await registerWithPasskey(ctx, TEST_ADMIN_EMAIL);
    const me = await request(ctx.app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(me.body.isAdmin).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest server/test/login.e2e.spec.ts --workspace server`
Expected: FAIL — `me.body` has no `isAdmin` key yet, so both the updated `toEqual` and the new test fail.

- [ ] **Step 3: Add `isAdmin` to the shared type and the controller**

In `shared/src/index.ts`, update `AuthUser`:

```ts
export interface AuthUser {
  id: string;
  email: string;
  isAdmin: boolean;
}
```

In `server/src/auth/auth.controller.ts`, add an `adminEmail` field read in the constructor and use it in `me()`:

```ts
export class AuthController {
  private readonly adminEmail: string;

  constructor(
    private auth: AuthService,
    private config: ConfigService,
    private webauthn: WebauthnService,
    private sessions: SessionService,
    private audit: AuditLogService,
  ) {
    this.adminEmail = this.config.getOrThrow<string>('ADMIN_EMAIL');
  }
```

```ts
  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthenticatedUser): AuthUser {
    return { id: user.userId, email: user.email, isAdmin: user.email === this.adminEmail };
  }
```

- [ ] **Step 4: Rebuild `shared` so the server picks up the type change**

Run: `npm run build:shared`
Expected: succeeds with no output errors.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest server/test/login.e2e.spec.ts --workspace server`
Expected: PASS

- [ ] **Step 6: Fix the client type error introduced by the new required field**

In `client/src/pages/OAuthConsentPage.spec.tsx`, update the mocked user literal in `'calls approve with the query params when authenticated'`:

```ts
      user: { id: 'u1', email: 'a@b.com', isAdmin: false },
```

- [ ] **Step 7: Verify the client still typechecks and its tests pass**

Run: `npm run build --workspace client`
Expected: succeeds (no `tsc` errors).

Run: `npm test --workspace client`
Expected: PASS

- [ ] **Step 8: Run the full server test suite to check for regressions**

Run: `npm test --workspace server`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add shared/src/index.ts server/src/auth/auth.controller.ts server/test/login.e2e.spec.ts client/src/pages/OAuthConsentPage.spec.tsx
git commit -m "feat: expose isAdmin on AuthUser and GET /auth/me"
```

---

### Task 4: `admin` module — guard + `GET /api/admin/users`

**Files:**
- Create: `server/src/admin/admin.guard.ts`
- Create: `server/src/admin/admin.service.ts`
- Create: `server/src/admin/admin.controller.ts`
- Create: `server/src/admin/admin.module.ts`
- Modify: `server/src/app.module.ts`
- Modify: `shared/src/index.ts` (adds `AdminUserDto`)
- Test: `server/test/admin-users.e2e.spec.ts` (new)

**Interfaces:**
- Consumes: `AuthGuard`, `AuthenticatedUser` (`server/src/auth-guard/session.service.ts`), `AuditLogService` (`server/src/audit/audit.service.ts`), `User` schema from Task 1.
- Produces: `AdminUserDto` (shared type), `AdminService.list(): Promise<AdminUserDto[]>`, `AdminService.toDto(doc): AdminUserDto` — consumed by Task 5's `setDisabled`. `AdminGuard` — chained after `AuthGuard` on every route in this module, consumed unchanged by Task 5.

- [ ] **Step 1: Write the failing e2e test**

Create `server/test/admin-users.e2e.spec.ts`:

```ts
import request from 'supertest';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx, TEST_ADMIN_EMAIL } from './utils/app';
import { seedAuthedUser } from './utils/auth';

describe('admin user management', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let adminCookie: string;
  let adminUserId: string;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    const admin = await seedAuthedUser(ctx.app, TEST_ADMIN_EMAIL);
    adminCookie = admin.cookie;
    adminUserId = admin.userId.toHexString();
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('401s the user list without a session', async () => {
    await request(ctx.app.getHttpServer()).get('/api/admin/users').expect(401);
  });

  it('403s the user list for a non-admin session', async () => {
    const { cookie } = await seedAuthedUser(ctx.app, 'plain@user.com');
    await request(ctx.app.getHttpServer())
      .get('/api/admin/users')
      .set('Cookie', cookie)
      .expect(403);
  });

  it('lists every user for the admin session', async () => {
    await seedAuthedUser(ctx.app, 'listed@user.com');
    const res = await request(ctx.app.getHttpServer())
      .get('/api/admin/users')
      .set('Cookie', adminCookie)
      .expect(200);
    const emails = res.body.map((u: { email: string }) => u.email);
    expect(emails).toEqual(
      expect.arrayContaining(['plain@user.com', 'listed@user.com', TEST_ADMIN_EMAIL]),
    );
    const admin = res.body.find((u: { email: string }) => u.email === TEST_ADMIN_EMAIL);
    expect(admin.disabled).toBe(false);
    expect(admin.emailVerified).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest server/test/admin-users.e2e.spec.ts --workspace server`
Expected: FAIL — all three requests 404 (route doesn't exist yet).

- [ ] **Step 3: Add `AdminUserDto` to the shared package**

In `shared/src/index.ts`, add near `AuthUser`:

```ts
export interface AdminUserDto {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  emailVerified: boolean;
  disabled: boolean;
}
```

- [ ] **Step 4: Rebuild shared**

Run: `npm run build:shared`
Expected: succeeds.

- [ ] **Step 5: Write the guard**

Create `server/src/admin/admin.guard.ts`:

```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth-guard/session.service';

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly adminEmail: string;

  constructor(private config: ConfigService) {
    this.adminEmail = this.config.getOrThrow<string>('ADMIN_EMAIL');
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>();
    if (req.user.email !== this.adminEmail) {
      throw new ForbiddenException('Admin access required.');
    }
    return true;
  }
}
```

- [ ] **Step 6: Write the service**

Create `server/src/admin/admin.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AdminUserDto } from '@finance/shared';
import { User, UserDocument } from '../database/schemas/user.schema';
import { AuditLogService } from '../audit/audit.service';

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    private audit: AuditLogService,
  ) {}

  toDto(doc: UserDocument): AdminUserDto {
    return {
      id: doc._id.toHexString(),
      email: doc.email,
      name: doc.name ?? null,
      createdAt: doc.createdAt.toISOString(),
      emailVerified: doc.emailVerified,
      disabled: doc.disabled,
    };
  }

  async list(): Promise<AdminUserDto[]> {
    const docs = await this.userModel.find().sort({ createdAt: 1 });
    return docs.map((d) => this.toDto(d));
  }
}
```

- [ ] **Step 7: Write the controller**

Create `server/src/admin/admin.controller.ts`:

```ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth-guard/auth.guard';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

@Controller('admin/users')
@UseGuards(AuthGuard, AdminGuard)
export class AdminController {
  constructor(private service: AdminService) {}

  @Get()
  list() {
    return this.service.list();
  }
}
```

- [ ] **Step 8: Write the module and register it**

Create `server/src/admin/admin.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuthGuardModule } from '../auth-guard/auth-guard.module';
import { AuditModule } from '../audit/audit.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminGuard } from './admin.guard';

@Module({
  imports: [AuthGuardModule, AuditModule],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard],
})
export class AdminModule {}
```

In `server/src/app.module.ts`, add the import and register it in the `imports` array (after `OauthModule`):

```ts
import { AdminModule } from './admin/admin.module';
```

```ts
    OauthModule,
    AdminModule,
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx jest server/test/admin-users.e2e.spec.ts --workspace server`
Expected: PASS

- [ ] **Step 10: Run the full server test suite to check for regressions**

Run: `npm test --workspace server`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add shared/src/index.ts server/src/admin server/src/app.module.ts server/test/admin-users.e2e.spec.ts
git commit -m "feat: add admin module with GET /api/admin/users"
```

---

### Task 5: `PATCH /api/admin/users/:id` — disable/enable with self-lockout + audit log

**Files:**
- Modify: `server/src/admin/admin.service.ts`
- Modify: `server/src/admin/admin.controller.ts`
- Create: `server/src/admin/dto.ts`
- Test: `server/test/admin-users.e2e.spec.ts`

**Interfaces:**
- Consumes: `AdminService.toDto()` from Task 4, `AuditLogService.log()` (`server/src/audit/audit.service.ts`, signature `log(entry: { userId, action, entityType?, entityId?, metadata? })`).
- Produces: `AdminService.setDisabled(adminUserId: string, targetId: string, disabled: boolean): Promise<AdminUserDto>` — used only by `AdminController` in this task, no other task depends on it further.

- [ ] **Step 1: Write the failing e2e tests**

Append to the `describe('admin user management', ...)` block in `server/test/admin-users.e2e.spec.ts` (after the `'lists every user for the admin session'` test, before the closing `});`):

```ts
  it('rejects the admin disabling their own account', async () => {
    await request(ctx.app.getHttpServer())
      .patch(`/api/admin/users/${adminUserId}`)
      .set('Cookie', adminCookie)
      .send({ disabled: true })
      .expect(400);
  });

  it('disables a user, blocking their session, then re-enables it', async () => {
    const target = await seedAuthedUser(ctx.app, 'revoke-me@user.com');

    await request(ctx.app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', target.cookie)
      .expect(200);

    const disableRes = await request(ctx.app.getHttpServer())
      .patch(`/api/admin/users/${target.userId.toHexString()}`)
      .set('Cookie', adminCookie)
      .send({ disabled: true })
      .expect(200);
    expect(disableRes.body.disabled).toBe(true);

    await request(ctx.app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', target.cookie)
      .expect(401);

    const enableRes = await request(ctx.app.getHttpServer())
      .patch(`/api/admin/users/${target.userId.toHexString()}`)
      .set('Cookie', adminCookie)
      .send({ disabled: false })
      .expect(200);
    expect(enableRes.body.disabled).toBe(false);

    await request(ctx.app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', target.cookie)
      .expect(200);
  });

  it('404s an unknown or malformed target id', async () => {
    await request(ctx.app.getHttpServer())
      .patch('/api/admin/users/000000000000000000000000')
      .set('Cookie', adminCookie)
      .send({ disabled: true })
      .expect(404);

    await request(ctx.app.getHttpServer())
      .patch('/api/admin/users/not-an-id')
      .set('Cookie', adminCookie)
      .send({ disabled: true })
      .expect(404);
  });

  it('400s a non-boolean disabled value', async () => {
    const target = await seedAuthedUser(ctx.app, 'bad-body@user.com');
    await request(ctx.app.getHttpServer())
      .patch(`/api/admin/users/${target.userId.toHexString()}`)
      .set('Cookie', adminCookie)
      .send({ disabled: 'yes' })
      .expect(400);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest server/test/admin-users.e2e.spec.ts --workspace server`
Expected: FAIL — all four new tests 404 (no `PATCH` route yet).

- [ ] **Step 3: Add the DTO**

Create `server/src/admin/dto.ts`:

```ts
import { IsBoolean } from 'class-validator';

export class SetUserDisabledDto {
  @IsBoolean()
  disabled: boolean;
}
```

- [ ] **Step 4: Add `setDisabled` to the service**

In `server/src/admin/admin.service.ts`, add imports and the method:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
```

```ts
  async setDisabled(
    adminUserId: string,
    targetId: string,
    disabled: boolean,
  ): Promise<AdminUserDto> {
    if (targetId === adminUserId) {
      throw new BadRequestException('Cannot change your own access.');
    }
    if (!Types.ObjectId.isValid(targetId)) {
      throw new NotFoundException();
    }
    const doc = await this.userModel.findByIdAndUpdate(targetId, { disabled }, { new: true });
    if (!doc) throw new NotFoundException();
    await this.audit.log({
      userId: adminUserId,
      action: disabled ? 'admin.user_disabled' : 'admin.user_enabled',
      entityType: 'User',
      entityId: targetId,
      metadata: { targetEmail: doc.email },
    });
    return this.toDto(doc);
  }
```

- [ ] **Step 5: Add the route to the controller**

In `server/src/admin/admin.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth-guard/auth.guard';
import { AdminGuard } from './admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth-guard/session.service';
import { AdminService } from './admin.service';
import { SetUserDisabledDto } from './dto';

@Controller('admin/users')
@UseGuards(AuthGuard, AdminGuard)
export class AdminController {
  constructor(private service: AdminService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Patch(':id')
  setDisabled(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SetUserDisabledDto,
  ) {
    return this.service.setDisabled(user.userId, id, dto.disabled);
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest server/test/admin-users.e2e.spec.ts --workspace server`
Expected: PASS

- [ ] **Step 7: Run the full server test suite to check for regressions**

Run: `npm test --workspace server`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add server/src/admin server/test/admin-users.e2e.spec.ts
git commit -m "feat: add PATCH /api/admin/users/:id to disable/enable access"
```

---

### Task 6: Client — admin users page, route, and nav link

**Files:**
- Create: `client/src/pages/AdminUsersPage.tsx`
- Create: `client/src/pages/AdminUsersPage.spec.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/Layout.tsx`

**Interfaces:**
- Consumes: `AdminUserDto` (shared, from Task 4), `AuthUser.isAdmin` (shared, from Task 3), `api()`/`ApiError` (`client/src/api.ts`), `useAuth()` (`client/src/auth-context.tsx`), `Badge`/`Button` (`client/src/components/`).

- [ ] **Step 1: Write the failing client test**

Create `client/src/pages/AdminUsersPage.spec.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AdminUsersPage from './AdminUsersPage';
import { api } from '../api';
import { useAuth } from '../auth-context';

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, api: vi.fn() };
});

vi.mock('../auth-context', () => ({
  useAuth: vi.fn(),
}));

const mockedApi = vi.mocked(api);
const mockedUseAuth = vi.mocked(useAuth);

describe('AdminUsersPage', () => {
  beforeEach(() => {
    mockedApi.mockReset();
    mockedUseAuth.mockReturnValue({
      user: { id: 'admin-1', email: 'admin@test.com', isAdmin: true },
      loading: false,
      refresh: vi.fn(),
    });
  });

  it('lists users with revoke/restore buttons, hiding the action for the admin\'s own row', async () => {
    mockedApi.mockResolvedValueOnce([
      {
        id: 'admin-1',
        email: 'admin@test.com',
        name: null,
        createdAt: '2026-07-01T00:00:00.000Z',
        emailVerified: true,
        disabled: false,
      },
      {
        id: 'user-2',
        email: 'plain@user.com',
        name: 'Plain User',
        createdAt: '2026-07-02T00:00:00.000Z',
        emailVerified: true,
        disabled: false,
      },
    ]);
    render(
      <MemoryRouter>
        <AdminUsersPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('plain@user.com')).toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: /revoke access/i })).toHaveLength(1);
  });

  it('revoking a user calls PATCH with disabled: true and reloads', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockedApi.mockResolvedValueOnce([
      {
        id: 'user-2',
        email: 'plain@user.com',
        name: null,
        createdAt: '2026-07-02T00:00:00.000Z',
        emailVerified: true,
        disabled: false,
      },
    ]);
    mockedApi.mockResolvedValueOnce({});
    mockedApi.mockResolvedValueOnce([
      {
        id: 'user-2',
        email: 'plain@user.com',
        name: null,
        createdAt: '2026-07-02T00:00:00.000Z',
        emailVerified: true,
        disabled: true,
      },
    ]);
    render(
      <MemoryRouter>
        <AdminUsersPage />
      </MemoryRouter>,
    );
    await waitFor(() => screen.getByRole('button', { name: /revoke access/i }));
    await userEvent.click(screen.getByRole('button', { name: /revoke access/i }));
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/admin/users/user-2', {
        method: 'PATCH',
        body: { disabled: true },
      }),
    );
    await waitFor(() => expect(screen.getByText(/disabled/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run client/src/pages/AdminUsersPage.spec.tsx --workspace client`
Expected: FAIL — `AdminUsersPage` module doesn't exist yet.

- [ ] **Step 3: Write the page**

Create `client/src/pages/AdminUsersPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { AdminUserDto } from '@finance/shared';
import { api, ApiError } from '../api';
import { useAuth } from '../auth-context';
import Badge from '../components/Badge';
import Button from '../components/Button';

export default function AdminUsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AdminUserDto[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setUsers(await api<AdminUserDto[]>('/admin/users'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function setDisabled(id: string, disabled: boolean) {
    setError('');
    if (disabled && !window.confirm("Revoke this user's access?")) return;
    try {
      await api(`/admin/users/${id}`, { method: 'PATCH', body: { disabled } });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-lg font-semibold">User management</h1>
      {error && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {error}
        </p>
      )}
      <ul className="divide-y divide-border rounded-lg border border-border">
        {users.map((u) => (
          <li key={u.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="text-sm text-ink">
                {u.email}
                {u.name ? <span className="text-muted"> ({u.name})</span> : null}
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                <span>registered {u.createdAt.slice(0, 10)}</span>
                {!u.emailVerified && <Badge tone="warning">Unverified</Badge>}
                {u.disabled && <Badge tone="danger">Disabled</Badge>}
              </div>
            </div>
            {u.id !== me?.id && (
              <Button
                variant={u.disabled ? 'secondary' : 'destructive'}
                onClick={() => setDisabled(u.id, !u.disabled)}
              >
                {u.disabled ? 'Restore access' : 'Revoke access'}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run client/src/pages/AdminUsersPage.spec.tsx --workspace client`
Expected: PASS

- [ ] **Step 5: Wire up the route**

In `client/src/App.tsx`, add the import:

```ts
import AdminUsersPage from './pages/AdminUsersPage';
```

Add a new `<Route>` after the `/settings/agent` route:

```tsx
          <Route
            path="/admin/users"
            element={
              <ProtectedRoute>
                <Layout>
                  <AdminUsersPage />
                </Layout>
              </ProtectedRoute>
            }
          />
```

- [ ] **Step 6: Add the nav link, shown only for the admin**

In `client/src/Layout.tsx`, inside `Layout`, right after `const { user, refresh } = useAuth();`:

```tsx
  const links = user?.isAdmin ? [...LINKS, ['/admin/users', 'Admin'] as const] : LINKS;
```

Replace both `{LINKS.map(([to, label]) => (` occurrences (desktop sidebar and mobile drawer — not the mobile bottom tab bar, which stays on `BOTTOM_LINKS`) with `{links.map(([to, label]) => (`.

- [ ] **Step 7: Manually verify in the browser**

Run: `npm run start:dev --workspace server` and, in another terminal, `npm run dev --workspace client`. Using Playwright MCP tools:
- Log in as a user whose email matches your local `.env`'s `ADMIN_EMAIL` — confirm an "Admin" nav link appears and `/admin/users` lists all registered users.
- Click "Revoke access" on a non-admin user, confirm the dialog, verify the row shows a "Disabled" badge and the button now reads "Restore access".
- Log in as the revoked user in a different browser context/incognito — confirm login is rejected.
- Click "Restore access" on that user, confirm the revoked user can log in again.
- Confirm the admin's own row shows no action button.
- Log in as a non-admin user — confirm no "Admin" nav link appears and navigating to `/admin/users` directly shows an error (403) rather than the user list.
Take a screenshot of the populated `/admin/users` page for the record.

- [ ] **Step 8: Run the full client test suite to check for regressions**

Run: `npm test --workspace client`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add client/src/pages/AdminUsersPage.tsx client/src/pages/AdminUsersPage.spec.tsx client/src/App.tsx client/src/Layout.tsx
git commit -m "feat: add admin user management page"
```
