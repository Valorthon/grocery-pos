import {
    REPORT_LIMITS,
    SalesReportGroup,
    PaymentType,
} from '@grocery-pos/contracts';
import {
    IsEnum,
    IsMongoId,
    IsNotEmpty,
    IsOptional,
    registerDecorator,
    type ValidationArguments,
} from 'class-validator';
import { IsCalendarDate, IsNotBefore } from '../common/validators';
import { parseIsoDate } from '../common/utils/timezone';

function IsBoundedReportRange() {
    return (target: object, propertyName: string) => {
        registerDecorator({
            name: 'isBoundedReportRange',
            target: target.constructor,
            propertyName,
            validator: {
                validate(value: unknown, args: ValidationArguments) {
                    const dto = args.object as SalesReportQuery;
                    if (
                        typeof dto.from !== 'string' ||
                        typeof value !== 'string'
                    )
                        return false;
                    const from = parseIsoDate(dto.from);
                    const to = parseIsoDate(value);
                    if (!from || !to) return false;
                    const days =
                        (Date.UTC(to.year, to.month - 1, to.day) -
                            Date.UTC(from.year, from.month - 1, from.day)) /
                            86_400_000 +
                        1;
                    return days > 0 && days <= REPORT_LIMITS.DAYS_MAX;
                },
                defaultMessage() {
                    return `Report range must contain at most ${REPORT_LIMITS.DAYS_MAX} days`;
                },
            },
        });
    };
}

export class SalesReportQuery {
    @IsNotEmpty()
    @IsCalendarDate()
    from!: string;

    @IsNotEmpty()
    @IsCalendarDate()
    @IsNotBefore('from')
    @IsBoundedReportRange()
    to!: string;

    @IsEnum(SalesReportGroup)
    groupBy: SalesReportGroup = SalesReportGroup.DAY;

    @IsOptional()
    @IsMongoId()
    cashier?: string;

    @IsOptional()
    @IsMongoId()
    category?: string;

    @IsOptional()
    @IsEnum(PaymentType)
    paymentType?: PaymentType;
}
