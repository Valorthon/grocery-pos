import { Module } from '@nestjs/common';
import { RefreshTokenService } from './refresh-token.service';
import { MongooseModule } from '@nestjs/mongoose';
import { RefreshToken, RefreshTokenSchema } from './refresh-token.schema';

@Module({
    imports: [
        MongooseModule.forFeature([
            {
                name: RefreshToken.name,
                schema: RefreshTokenSchema,
            },
        ]),
    ],
    providers: [RefreshTokenService],
    exports: [RefreshTokenService],
})
export class RefreshTokenModule {}
