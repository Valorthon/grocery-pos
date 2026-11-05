import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayNotEmpty,
    ArrayUnique,
    IsArray,
    IsIn,
    IsInt,
    IsMongoId,
    Max,
    Min,
    ValidateIf,
    ValidateNested,
} from 'class-validator';
import {
    PAGINATION,
    STOCK_COUNT_LINE_MAX,
    StockCountStatus,
    type CreateStockCountRequest,
    type SaveStockCountRequest,
    type StockCountLineInput,
    type StockCountVersionRequest,
} from '@grocery-pos/contracts';

export class StockCountIdDto {
    @IsMongoId() id!: string;
}
export class StockCountQueryDto {
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
    @ValidateIf((_o, v: unknown) => v !== undefined)
    @IsIn(Object.values(StockCountStatus))
    status?: StockCountStatus;
}
export class CreateStockCountDto implements CreateStockCountRequest {
    @IsIn(['all', 'category', 'products']) scope!:
        'all' | 'category' | 'products';
    @ValidateIf((_o, v: unknown) => v !== undefined)
    @IsMongoId()
    category?: string;
    @ValidateIf((_o, v: unknown) => v !== undefined)
    @IsArray()
    @ArrayNotEmpty()
    @ArrayMaxSize(STOCK_COUNT_LINE_MAX)
    @ArrayUnique()
    @IsMongoId({ each: true })
    products?: string[];
}
export class StockCountLineDto implements StockCountLineInput {
    @IsMongoId() line!: string;
    @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) countedQty!: number;
}
export class StockCountVersionDto implements StockCountVersionRequest {
    @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) version!: number;
}
export class SaveStockCountDto
    extends StockCountVersionDto
    implements SaveStockCountRequest
{
    @IsArray()
    @ArrayNotEmpty()
    @ArrayMaxSize(STOCK_COUNT_LINE_MAX)
    @ValidateNested({ each: true })
    @Type(() => StockCountLineDto)
    lines!: StockCountLineDto[];
}
