export class JWTInvalidError extends Error {
    constructor() {
        super(`JWT Invalid`);
    }
}
