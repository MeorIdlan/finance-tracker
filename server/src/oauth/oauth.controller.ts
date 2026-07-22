import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Query,
  Redirect,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { AuthGuard } from '../auth-guard/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth-guard/session.service';
import { AgentTokenService } from '../agent/agent-token.service';
import { OauthCodeStore } from './oauth-code.store';
import { ApproveAuthorizeDto, RegisterClientDto, TokenExchangeDto } from './dto';
import { verifyPkce } from './pkce';

const CODE_TTL_MS = 60_000;

function isLoopbackRedirect(redirectUri: string | undefined): boolean {
  if (!redirectUri) return false;
  try {
    const url = new URL(redirectUri);
    return (
      url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
    );
  } catch {
    return false;
  }
}

@Controller('oauth')
export class OauthController {
  constructor(
    private tokens: AgentTokenService,
    private codes: OauthCodeStore,
    private config: ConfigService,
  ) {}

  @Post('register')
  @HttpCode(201)
  register(@Body() body: RegisterClientDto) {
    // RFC 7591: the response MUST echo back the client's registered metadata
    // (redirect_uris is a required field on the client's parsing schema) —
    // returning only client_id fails client-side validation silently.
    return {
      client_id: randomBytes(12).toString('hex'),
      redirect_uris: body.redirect_uris,
      grant_types: body.grant_types ?? ['authorization_code'],
      response_types: body.response_types ?? ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  @Get('authorize')
  @Redirect()
  authorize(@Query() query: Record<string, string>) {
    if (!isLoopbackRedirect(query.redirect_uri)) {
      throw new HttpException('redirect_uri must be a loopback address', HttpStatus.BAD_REQUEST);
    }
    const origin = this.config.get('WEBAUTHN_ORIGIN', 'http://localhost:5173');
    const params = new URLSearchParams(query).toString();
    return { url: `${origin}/oauth-consent?${params}` };
  }

  @Post('authorize/approve')
  @UseGuards(AuthGuard)
  async approve(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ApproveAuthorizeDto,
  ) {
    if (!isLoopbackRedirect(body.redirectUri)) {
      throw new HttpException('redirect_uri must be a loopback address', HttpStatus.BAD_REQUEST);
    }
    const { token } = await this.tokens.create(
      user.userId,
      'Claude Desktop (OAuth)',
      'oauth',
    );
    const code = this.codes.create({
      userId: user.userId,
      token,
      redirectUri: body.redirectUri,
      codeChallenge: body.codeChallenge,
      expiresAt: Date.now() + CODE_TTL_MS,
    });
    const redirectUrl = new URL(body.redirectUri);
    redirectUrl.searchParams.set('code', code);
    if (body.state) redirectUrl.searchParams.set('state', body.state);
    return { redirectUrl: redirectUrl.toString() };
  }

  @Post('token')
  @HttpCode(201)
  async token(@Body() body: TokenExchangeDto) {
    const entry = this.codes.consume(body.code);
    if (
      !entry ||
      entry.redirectUri !== body.redirect_uri ||
      !verifyPkce(body.code_verifier, entry.codeChallenge)
    ) {
      throw new HttpException({ error: 'invalid_grant' }, HttpStatus.BAD_REQUEST);
    }
    return { access_token: entry.token, token_type: 'Bearer' };
  }
}
