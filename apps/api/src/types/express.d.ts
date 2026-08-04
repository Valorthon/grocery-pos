import { AuthUser } from '../auth/types/auth.types';

declare global {
    namespace Express {
        interface Request {
            user?: AuthUser;
        }
    }
}
export {};
