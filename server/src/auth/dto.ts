import {
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
} from 'class-validator';

export class EmailDto {
  @IsEmail()
  email: string;
}

export class RegisterDto {
  @IsString()
  @MinLength(1)
  @Matches(/\S/, { message: 'name must not be blank' })
  name: string;

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
