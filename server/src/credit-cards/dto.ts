import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCreditCardDto {
  @IsString()
  @MaxLength(60)
  name: string;

  @IsInt()
  @Min(1)
  creditLimit: number;

  @IsInt()
  @Min(1)
  @Max(28)
  statementDay: number;

  @IsInt()
  @Min(1)
  @Max(28)
  dueDay: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  currentBalance?: number;
}

export class UpdateCreditCardDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  creditLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  statementDay?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  dueDay?: number;
}
