import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EANCounter } from './ean-counter.schema';
import { ClientSession, Model } from 'mongoose';
import { TypedConfigService } from '../common/typed-config/typed-config.service';
import { InternalError } from '../common/errors';
import { BARCODE_LENGTHS, gtinCheckDigit } from '@grocery-pos/contracts';

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

        const range = Math.pow(
            10,
            this.configService.get('EAN_COUNTER_DIGITS'),
        );

        // Past its digits the counter would spill into the prefix (200 ->
        // 201...) and leave the reserved range, where it could collide with
        // a typed barcode.
        if (counterDoc.counter >= range) {
            throw new InternalError('EAN counter exhausted');
        }

        const tempEAN = counterDoc.prefix * range + counterDoc.counter;

        // Always 12 data digits: the env schema pins EAN_COUNTER_DIGITS so
        // prefix + counter fill them. Every generated code is therefore a
        // 13-digit EAN-13 starting with the prefix, the range that typed
        // barcodes may not use (`isReservedBarcode` in contracts).
        const body = tempEAN.toString();
        if (body.length !== BARCODE_LENGTHS.EAN_13 - 1) {
            throw new InternalError('EAN Generation Error');
        }
        return `${body}${gtinCheckDigit(body)}`;
    }
}
