import { Type } from 'class-transformer';
import { IsInt, IsMongoId, Max, Min, ValidateIf } from 'class-validator';
import { PAGINATION } from '@grocery-pos/contracts';
import { IsCalendarDate, IsNotBefore } from '../common/validators';

export class StockMovementProductDto {
    @IsMongoId() id!: string;
}
export class StockMovementQueryDto {
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(PAGINATION.PAGE_MAX)
    page: number = 1;

    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(PAGINATION.LIMIT_MAX)
    limit: number = 20;

    @ValidateIf((_o, value: unknown) => value !== undefined)
    @IsCalendarDate()
    from?: string;

    @ValidateIf((_o, value: unknown) => value !== undefined)
    @IsCalendarDate()
    @IsNotBefore('from')
    to?: string;
}
