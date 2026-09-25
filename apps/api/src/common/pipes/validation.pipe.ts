import { ValidationPipe } from '@nestjs/common';

/**
 * The one global pipe main.ts registers, shared with the e2e harnesses so
 * specs validate exactly as the app does.
 *
 * Request text is stored as typed (issue #15): there is no HTML sanitising
 * or entity encoding on the way in, because nothing stores rich text and the
 * client escapes on render (Vue interpolation; no `v-html`). Whitespace is
 * trimmed per field by `@Transform` on the DTOs, which class-transformer
 * runs inside this pipe BEFORE class-validator, so `@MaxLength` sees the
 * final value. Password fields carry no transform and reach the service
 * verbatim, leading and trailing spaces included.
 */
export function createValidationPipe(): ValidationPipe {
    return new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
    });
}
