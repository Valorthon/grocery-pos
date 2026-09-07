declare module 'express-serve-static-core' {
    interface Request {
        signedCookies?: Record<string, string | undefined>;
    }
}
export {};
