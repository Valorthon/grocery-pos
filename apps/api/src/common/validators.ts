import {
    registerDecorator,
    ValidationOptions,
    ValidationArguments,
} from 'class-validator';

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
