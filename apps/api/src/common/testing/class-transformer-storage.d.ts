/**
 * class-transformer ships the types of its metadata storage but no typings
 * for the CommonJS path that exports it. Test-only: specs read `@Type`
 * metadata to walk nested DTOs.
 */
declare module 'class-transformer/cjs/storage' {
    import type { MetadataStorage } from 'class-transformer/types/MetadataStorage';

    export const defaultMetadataStorage: MetadataStorage;
}
