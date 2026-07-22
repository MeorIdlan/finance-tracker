import { ArrayNotEmpty, IsArray, IsIn, IsOptional, IsString } from 'class-validator';

export class RegisterClientDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  redirect_uris: string[];

  @IsOptional()
  @IsString()
  client_name?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  grant_types?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  response_types?: string[];
}

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
