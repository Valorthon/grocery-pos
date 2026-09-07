import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvTypes } from './validation.env';

@Injectable()
export class TypedConfigService extends ConfigService<EnvTypes> {
    get<Key extends keyof EnvTypes>(key: Key): EnvTypes[Key] {
        const val = super.get(key, { infer: true });

        if (val === undefined) {
            throw new Error(`Missing env variable: ${String(key)}`);
        }

        return val;
    }
}
