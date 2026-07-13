import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCommitmentDto {
  @IsString()
  @MaxLength(60)
  name: string;

  @IsInt()
  @Min(1)
  amount: number;

  @IsInt()
  @Min(1)
  @Max(31)
  dueDayOfMonth: number;
}

export class UpdateCommitmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dueDayOfMonth?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
