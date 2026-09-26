import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvTypes, OPTIONAL_ENV_KEYS } from './validation.env';

@Injectable()
export class TypedConfigService extends ConfigService<EnvTypes> {
    /**
     * A key the schema marks optional (DOMAIN outside prod/stage) returns
     * `undefined` when unset, as its type says (#91). Any other missing key
     * means the config was never validated, so it still throws.
     */
    get<Key extends keyof EnvTypes>(key: Key): EnvTypes[Key] {
        const val = super.get(key, { infer: true });

        if (val === undefined && !OPTIONAL_ENV_KEYS.has(key)) {
            throw new Error(`Missing env variable: ${String(key)}`);
        }

        return val as EnvTypes[Key];
    }
}
