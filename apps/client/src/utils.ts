import constant from '@/constant';

class Utils {
    static instance: Utils;

    constructor() {
        if (!Utils.instance) {
            Utils.instance = this;
        }
        return Utils.instance;
    }

    getToken(): string {
        return '?token=' + localStorage.getItem('token');
    }

    _api(method: string): string {
        return constant.apiv1 + method;
    }
}

const instance = new Utils();
Object.freeze(instance);
export default instance;
