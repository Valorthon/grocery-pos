import {
    IsString,
    IsOptional,
    IsPositive,
    IsNumber,
    IsNotEmpty,
    MaxLength,
} from 'class-validator';
import { STRING_LIMITS } from '../../../constants';

export class GetAllDto {
    @IsOptional()
    @IsNumber()
    maxStock!: number;

    @IsString()
    @IsOptional()
    @MaxLength(STRING_LIMITS.PRODUCT_NAME)
    name!: string;

    @IsString()
    @IsOptional()
    @MaxLength(STRING_LIMITS.EAN)
    EAN!: string;

    @IsPositive()
    @IsNumber()
    @IsNotEmpty()
    page!: number;

    @IsPositive()
    @IsNumber()
    @IsNotEmpty()
    limit!: number;
}
