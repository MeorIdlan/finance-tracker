import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateLoanDto {
  @IsString()
  @MaxLength(60)
  name: string;

  @IsInt()
  @Min(1)
  principal: number;

  @IsNumber()
  @Min(0)
  interestRate: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  currentBalance?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;
}

export class UpdateLoanDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  interestRate?: number;
}
