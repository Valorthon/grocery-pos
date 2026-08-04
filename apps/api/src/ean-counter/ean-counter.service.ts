import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EANCounter } from './ean-counter.schema';
import { ClientSession, Model } from 'mongoose';
import { TypedConfigService } from '../common/typed-config/typed-config.service';
import { ErrorCode, InternalError, ValidationError } from '../common/errors';

@Injectable()
export class EanCounterService {
    constructor(
        @InjectModel(EANCounter.name) private model: Model<EANCounter>,
        private configService: TypedConfigService,
    ) {}

    async generate(session?: ClientSession): Promise<string> {
        const counterDoc = await this.model
            .findByIdAndUpdate(
                this.configService.get('EAN_COUNTER_ID'),
                {
                    $inc: { counter: 1 },
                },
                {
                    new: true,
                    upsert: true,
                    session,
                },
            )
            .lean();

        const tempEAN =
            counterDoc.prefix *
                Math.pow(10, this.configService.get('EAN_COUNTER_DIGITS')) +
            counterDoc.counter;

        const checksum = this.calculateChecksum(tempEAN.toString());
        const result = tempEAN * 10 + checksum;
        return result.toString();
    }

    ensureValid(EAN: string) {
        if (!/^\d{13}$/.test(EAN))
            throw new ValidationError(
                ErrorCode.VALIDATION_EAN_INVALID,
                'EAN must be 13 digits (numbers) long',
            );

        const correctChecksum = this.calculateChecksum(EAN.slice(0, -1));

        if (correctChecksum.toString() !== EAN.at(-1))
            throw new ValidationError(
                ErrorCode.VALIDATION_EAN_INVALID,
                'EAN checksum is invalid',
            );
    }

    private calculateChecksum(tempEAN: string): number {
        if (tempEAN.length < 12) {
            throw new InternalError('EAN Generation Error');
        }

        let oddSum = 0;
        let evenSum = 0;

        for (let x = 0; x < tempEAN.length; ++x) {
            const num = Number(tempEAN[x]);
            if (x % 2 === 0) oddSum += num;
            else evenSum += num;
        }

        evenSum *= 3;

        return (10 - ((oddSum + evenSum) % 10)) % 10;
    }
}
