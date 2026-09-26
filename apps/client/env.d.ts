/// <reference types="vite/client" />

declare module '*.vue' {
    // Read only by tools without Vue support (typescript-eslint); vue-tsc
    // types each .vue file itself.
    import type { DefineComponent } from 'vue';
    const component: DefineComponent;
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
