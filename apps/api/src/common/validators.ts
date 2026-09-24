import {
    registerDecorator,
    ValidationOptions,
    ValidationArguments,
} from 'class-validator';
import { parseIsoDate } from './utils/timezone';

export function RequiresOne(
    properties: string[],
    validationOptions?: ValidationOptions,
) {
    return function (target: object, propertyName: string) {
        registerDecorator({
            name: 'requiresOne',
            target: target.constructor,
            propertyName: propertyName,
            options: validationOptions,
            constraints: properties,
            validator: {
                validate(_value: unknown, args: ValidationArguments) {
                    const dto = args.object as Record<string, unknown>;
                    return properties.some(
                        (prop) =>
                            dto[prop] !== null &&
                            dto[prop] !== undefined &&
                            dto[prop] !== '',
                    );
                },
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                defaultMessage(_: ValidationArguments) {
                    return `At least one of the following must be provided: ${properties.join(', ')}`;
                },
            },
        });
    };
}

/** A real calendar date in strict `YYYY-MM-DD` form (no time, no offset). */
export function IsCalendarDate(validationOptions?: ValidationOptions) {
    return function (target: object, propertyName: string) {
        registerDecorator({
            name: 'isCalendarDate',
            target: target.constructor,
            propertyName: propertyName,
            options: validationOptions,
            validator: {
                validate(value: unknown) {
                    return (
                        typeof value === 'string' &&
                        parseIsoDate(value) !== null
                    );
                },
                defaultMessage(args: ValidationArguments) {
                    return `${args.property} must be a date in YYYY-MM-DD format`;
                },
            },
        });
    };
}
