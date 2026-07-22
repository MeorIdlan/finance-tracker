import { IsIn, IsOptional, IsString } from 'class-validator';

export class ApproveAuthorizeDto {
  @IsString()
  redirectUri: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsString()
  codeChallenge: string;

  @IsIn(['S256'])
  codeChallengeMethod: string;
}

export class TokenExchangeDto {
  @IsIn(['authorization_code'])
  grant_type: string;

  @IsString()
  code: string;

  @IsString()
  code_verifier: string;

  @IsString()
  redirect_uri: string;
}
