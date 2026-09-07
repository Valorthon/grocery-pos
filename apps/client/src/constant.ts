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
