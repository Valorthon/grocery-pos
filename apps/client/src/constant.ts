export interface AppConstant {
    login: string;
    logout: string;
    refresh: string;
}

const constant: AppConstant = {
    // Auth endpoints
    login: '/auth/login',
    logout: '/auth/logout',
    refresh: '/auth/refresh',
};

export default constant;

/**
 * The login hero photo (#26): served from `public/`, fetched at deploy
 * (README, "Login hero photo"), never from a third-party host. A missing
 * file only leaves the gradient under it.
 */
export const LOGIN_HERO_URL = `${import.meta.env.BASE_URL}images/login-hero.jpg`;
