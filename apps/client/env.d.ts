/// <reference types="vite/client" />

export {};

declare module '*.vue' {
    import type { DefineComponent } from 'vue';
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-explicit-any
    const component: DefineComponent<{}, {}, any>;
    export default component;
}

declare module '*.png' {
    const src: string;
    export default src;
}

declare module '*.svg' {
    const src: string;
    export default src;
}

declare module 'vue-toast-notification' {
    import type { Plugin } from 'vue';
    const Toast: Plugin;
    export default Toast;
}

declare module 'vue' {
    export interface ComponentCustomProperties {
        $axios: import('axios').AxiosInstance;
    }
}
