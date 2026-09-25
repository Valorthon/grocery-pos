import {
    registerDecorator,
    ValidationOptions,
    ValidationArguments,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { BARCODE_MESSAGES, barcodeError } from '@grocery-pos/contracts';
import { parseIsoDate } from './utils/timezone';

/** A value counts as provided unless it is undefined, null or ''. */
function isProvided(value: unknown): boolean {
    return value !== undefined && value !== null && value !== '';
}

/**
 * Registers a check on the whole object rather than on one property.
 *
 * class-validator only runs validators keyed by a property name, so the
 * check is keyed by a synthetic name (e.g. `exactlyOneOf(newProduct,
 * product)`) that no real field has. Being registered, that name is
 * whitelisted, so the check also fails if a request sends any value under
 * it: nothing can ride in through it. It never appears in error messages;
 * the ValidationPipe reports constraint messages only.
 */
function registerClassCheck(
    name: string,
    properties: string[],
    check: (presentCount: number) => boolean,
    message: string,
    validationOptions?: ValidationOptions,
): ClassDecorator {
    return (target) => {
        registerDecorator({
            name,
            target,
            propertyName: `${name}(${properties.join(',')})`,
            options: validationOptions,
            constraints: properties,
            validator: {
                validate(value: unknown, args: ValidationArguments) {
                    const dto = args.object as Record<string, unknown>;
                    const present = properties.filter((prop) =>
                        isProvided(dto[prop]),
                    ).length;
                    return value === undefined && check(present);
                },
                defaultMessage() {
                    return message;
                },
            },
        });
    };
}

/**
 * Class decorator: exactly one of `properties` must be provided (not
 * undefined, null or ''). Neither and more than one are both refused.
 */
export function ExactlyOneOf(
    properties: string[],
    validationOptions?: ValidationOptions,
): ClassDecorator {
    return registerClassCheck(
        'exactlyOneOf',
        properties,
        (present) => present === 1,
        `Exactly one of the following must be provided: ${properties.join(', ')}`,
        validationOptions,
    );
}

/**
 * Class decorator: at least one of `properties` must be provided (not
 * undefined, null or ''), e.g. so an update cannot be empty.
 */
export function AtLeastOneOf(
    properties: string[],
    validationOptions?: ValidationOptions,
): ClassDecorator {
    return registerClassCheck(
        'atLeastOneOf',
        properties,
        (present) => present >= 1,
        `At least one of the following must be provided: ${properties.join(', ')}`,
        validationOptions,
    );
}

/**
 * A product barcode a person typed or scanned: EAN-13, UPC-A or EAN-8 with
 * a valid check digit, outside the store's generated range (issue #14).
 * The rules live in `@grocery-pos/contracts` (`barcodeError`), shared with
 * the client; the message says which rule failed.
 */
export function IsBarcode(validationOptions?: ValidationOptions) {
    return function (target: object, propertyName: string) {
        registerDecorator({
            name: 'isBarcode',
            target: target.constructor,
            propertyName,
            options: validationOptions,
            validator: {
                validate(value: unknown) {
                    return (
                        typeof value === 'string' &&
                        barcodeError(value) === null
                    );
                },
                defaultMessage(args: ValidationArguments) {
                    return typeof args.value === 'string'
                        ? (barcodeError(args.value) ?? BARCODE_MESSAGES.FORMAT)
                        : BARCODE_MESSAGES.FORMAT;
                },
            },
        });
    };
}

/** Trims a string field; anything else passes through for the validators. */
export function Trim() {
    return Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : (value as unknown),
    );
}

/**
 * Trims and lowercases a string field, as product names are stored, so a
 * name search matches regardless of the case typed.
 */
export function TrimLowercase() {
    return Transform(({ value }) =>
        typeof value === 'string'
            ? value.trim().toLowerCase()
            : (value as unknown),
    );
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
