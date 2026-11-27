import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import {
    ErrorCode,
    TERMINAL_ID_HEADER,
    TERMINAL_ID_PATTERN,
} from '@grocery-pos/contracts';
import { ValidationError } from '../common/errors/app-error';

/** The request's terminal id header, or undefined when absent or malformed. */
export function terminalIdOf(
    req: Pick<Request, 'headers'>,
): string | undefined {
    const raw = req.headers[TERMINAL_ID_HEADER];
    return typeof raw === 'string' && TERMINAL_ID_PATTERN.test(raw)
        ? raw
        : undefined;
}

/** Throws SHIFT_TERMINAL_REQUIRED (400) without a valid terminal id. */
export function requireTerminalId(id: string | undefined): string {
    if (id === undefined)
        throw new ValidationError(
            ErrorCode.SHIFT_TERMINAL_REQUIRED,
            'This page is out of date. Reload it and try again.',
        );
    return id;
}

/**
 * The browser's terminal id (#509) from `TERMINAL_ID_HEADER`. With
 * `{ required: true }` a missing or malformed one is refused with 400
 * SHIFT_TERMINAL_REQUIRED before the handler runs.
 */
export const TerminalId = createParamDecorator(
    (
        options: { required?: boolean } | undefined,
        ctx: ExecutionContext,
    ): string | undefined => {
        const id = terminalIdOf(ctx.switchToHttp().getRequest<Request>());
        return options?.required ? requireTerminalId(id) : id;
    },
);
