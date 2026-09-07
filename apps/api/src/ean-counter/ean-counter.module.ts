import { Module } from '@nestjs/common';
import { EanCounterService } from './ean-counter.service';
import { MongooseModule } from '@nestjs/mongoose';
import { EANCounter, EANCounterSchema } from './ean-counter.schema';

@Module({
    imports: [
        MongooseModule.forFeature([
            {
                name: EANCounter.name,
                schema: EANCounterSchema,
            },
        ]),
    ],
    providers: [EanCounterService],
    exports: [EanCounterService],
})
export class EanCounterModule {}
