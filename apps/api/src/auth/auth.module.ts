import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { CookieModule } from '../common/utils/cookie/cookie.module';
import { UserModule } from '../user/user.module';
import { JWTStrategy } from './jwt.strategy';
import { RefreshTokenModule } from './refresh-token/refresh-token.module';
import { RateLimitModule } from './rate-limit/rate-limit';

@Module({
    imports: [
        UserModule,
        JwtModule.register({}),
        CookieModule,
        RefreshTokenModule,
        RateLimitModule,
    ],
    controllers: [AuthController],
    providers: [AuthService, JWTStrategy],
    exports: [AuthService],
})
export class AuthModule {}
