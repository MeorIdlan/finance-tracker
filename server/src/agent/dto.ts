import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAgentTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label: string;
}
