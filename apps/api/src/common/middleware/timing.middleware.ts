import { Request, Response, NextFunction } from 'express';
import { Logger } from '@nestjs/common';

const logger = new Logger('Timing');

export function TimingMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
): void {
    const start = performance.now();
    const { method, url } = req;
    let isLogged = false;

    const logTime = () => {
        if (isLogged) return;
        isLogged = true;

        const duration = performance.now() - start;
        logger.log(
            `[${method}] ${url} - ${res.statusCode} - ${duration.toFixed(2)}ms`,
        );
    };

    res.on('finish', logTime);
    res.on('close', logTime);

    next();
}
