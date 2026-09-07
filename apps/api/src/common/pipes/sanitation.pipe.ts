import { ArgumentMetadata, Injectable } from '@nestjs/common';
import { PipeTransform } from '@nestjs/common';
import sanitize from 'sanitize-html';

@Injectable()
export class SanitationPipe implements PipeTransform {
    constructor(excludeFields: string[]) {
        this.excludeFields = excludeFields;
    }

    private readonly excludeFields: string[];

    transform(value: unknown, metadata: ArgumentMetadata): unknown {
        if (
            metadata.type === 'body' &&
            value !== null &&
            typeof value === 'object'
        ) {
            return this.smartSanitize(value);
        }

        return value;
    }

    private smartSanitize(value: unknown): unknown {
        if (typeof value === 'string') {
            return sanitize(value, {
                allowedAttributes: {},
                allowedTags: [],
            }).trim();
        }

        if (Array.isArray(value)) {
            return value.map((item: unknown) => this.smartSanitize(item));
        }

        if (
            value &&
            typeof value === 'object' &&
            value.constructor === Object
        ) {
            const sanitizedObj: Record<string, unknown> = {};

            for (const [key, val] of Object.entries(value)) {
                if (this.excludeFields.includes(key)) {
                    sanitizedObj[key] = val;
                } else {
                    sanitizedObj[key] = this.smartSanitize(val);
                }
            }

            return sanitizedObj;
        }

        return value;
    }
}
