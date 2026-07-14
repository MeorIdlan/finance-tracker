import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBankAccountDto {
  @IsString()
  @MaxLength(60)
  name: string;

  @IsInt()
  @Min(0)
  openingBalance: number;
}

export class UpdateBankAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;
}

export class CreateSavingsAccountDto {
  @IsString()
  @MaxLength(60)
  name: string;

  @IsIn(['savings', 'investment'])
  type: 'savings' | 'investment';
}

export class UpdateSavingsAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;
}

export class CreateSnapshotDto {
  @IsDateString()
  date: string;

  @IsInt()
  @Min(0)
  value: number;
}
