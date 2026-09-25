import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './user.schema';
import { UserController } from './user.controller';
import { RefreshTokenModule } from '../auth/refresh-token/refresh-token.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            {
                name: User.name,
                schema: UserSchema,
            },
        ]),
        RefreshTokenModule,
    ],
    providers: [UserService],
    exports: [UserService],
    controllers: [UserController],
})
export class UserModule {}
