import { Module } from '@nestjs/common';
import { RefreshTokenService } from './refresh-token.service';
import { MongooseModule } from '@nestjs/mongoose';
import { RefreshToken, RefreshTokenSchema } from './refresh-token.schema';
import { StepUp, StepUpSchema } from '../step-up/step-up.schema';
import { StepUpService } from '../step-up/step-up.service';

@Module({
    imports: [
        MongooseModule.forFeature([
            {
                name: RefreshToken.name,
                schema: RefreshTokenSchema,
            },
            { name: StepUp.name, schema: StepUpSchema },
        ]),
    ],
    providers: [RefreshTokenService, StepUpService],
    exports: [RefreshTokenService, StepUpService],
})
export class RefreshTokenModule {}
