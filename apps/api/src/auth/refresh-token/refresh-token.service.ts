import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { RefreshToken } from './refresh-token.schema';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { TypedConfigService } from '../../common/typed-config/typed-config.service';
import { JWTPayload, Role } from '../types';
import { AuthError, ErrorCode } from '../../common/errors';

type FoundRefresh = Omit<RefreshToken, 'user'> & {
    user: {
        _id: Types.ObjectId;
        name: string;
        roles: Role[];
    };
};

@Injectable()
export class RefreshTokenService {
    constructor(
        @InjectConnection() private connection: Connection,
        @InjectModel(RefreshToken.name) private model: Model<RefreshToken>,
        private config: TypedConfigService,
    ) {}

    async create(
        userId: string,
        expiry?: Date,
        session?: ClientSession,
    ): Promise<string> {
        const newExpiry =
            expiry ?? new Date(Date.now() + this.config.get('REFRESH_EXPIRY'));

        const [created] = await this.model.create(
            [
                {
                    user: userId,
                    expiry: newExpiry,
                },
            ],
            { session },
        );

        return created._id.toString();
    }

    async rotate(
        refreshId: string,
    ): Promise<{ refreshId: string; jwtPayload: JWTPayload }> {
        const found = await this.model
            .findByIdAndDelete(refreshId)
            .populate('user')
            .lean<FoundRefresh>();

        if (!found || !this.checkValid(found)) {
            throw new AuthError(
                ErrorCode.AUTH_MISSING_REFRESH_TOKEN,
                `Please login again`,
            );
        }

        const newRefreshId = await this.create(
            found.user._id.toString(),
            found.expiry,
        );
        const jwtPayload: JWTPayload = {
            userId: found.user._id.toString(),
            username: found.user.name,
            roles: found.user.roles,
        };

        return {
            refreshId: newRefreshId,
            jwtPayload,
        };
    }

    async invalidate(_id: string): Promise<void> {
        await this.model.findByIdAndDelete(_id, { isValid: false });
    }

    private checkValid(refreshToken: FoundRefresh): boolean {
        return (
            !!refreshToken &&
            refreshToken.expiry.getTime() > Date.now() &&
            refreshToken.isValid
        );
    }
}
