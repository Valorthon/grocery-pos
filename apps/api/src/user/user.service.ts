import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { User } from './user.schema';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import * as argon from 'argon2';
import { Role } from '../auth/types/auth.types';
import { CreateBulkDto, GetAllDto, UpdateBulkDto } from './types';
import { runInTransaction } from '../common/utils/db';

class UserInfo {
    name!: string;
    roles!: Role[];
    _id!: Types.ObjectId;
    isActive!: boolean;
}

@Injectable()
export class UserService {
    constructor(
        @InjectConnection() private connection: Connection,
        @InjectModel(User.name) private model: Model<User>,
    ) {}

    async getAll(
        dto: GetAllDto,
    ): Promise<{ data: User[]; totalItems: number }> {
        const { page, limit, name } = dto;

        const skip = (page - 1) * limit;

        const query: Record<string, unknown> = {};
        if (name) {
            const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            query.name = { $regex: `^${escaped}` };
        }

        const [data, totalItems] = await Promise.all([
            this.model
                .find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .select('-passwordHash -__v')
                .lean(),

            query?.name
                ? this.model.countDocuments(query)
                : this.model.estimatedDocumentCount(),
        ]);

        return {
            data,
            totalItems,
        };
    }

    async update(dto: UpdateBulkDto, session?: ClientSession): Promise<void> {
        const updates = await this.prepareUpdates(dto);

        return await runInTransaction(
            async (session) => {
                await this.model.bulkWrite(updates, { session });
            },
            this.connection,
            session,
        );
    }

    private async prepareUpdates(dto: UpdateBulkDto) {
        const newDto = await Promise.all(
            dto.updates.map(async ({ user, update }) => {
                const newUpdate: Record<string, unknown> = { ...update };

                if (typeof newUpdate.password === 'string') {
                    const passwordHash = await argon.hash(newUpdate.password);
                    newUpdate.passwordHash = passwordHash;
                    delete newUpdate.password;
                }

                return { user, newUpdate };
            }),
        );

        return newDto.map(({ user, newUpdate }) => ({
            updateOne: {
                filter: { _id: user },
                update: { $set: newUpdate },
            },
        }));
    }

    async create(dto: CreateBulkDto, session?: ClientSession): Promise<void> {
        const inserts = await Promise.all(
            dto.users.map(async (user) => ({
                name: user.name,
                passwordHash: await argon.hash(user.password),
                roles: user.roles,
            })),
        );

        await runInTransaction(
            async (session) => {
                await this.model.insertMany(inserts, { session });
            },
            this.connection,
            session,
        );
    }

    async checkCredentials(
        username: string,
        password: string,
    ): Promise<UserInfo | null> {
        const user = await this.model.findOne({ name: username }).lean();

        if (!user) {
            return null;
        }

        const isMatch = await argon.verify(user.passwordHash, password);
        if (!isMatch) {
            return null;
        }

        return {
            name: user.name,
            roles: user.roles,
            _id: user._id,
            isActive: user.isActive,
        };
    }

    async checkActivated(username: string): Promise<boolean> {
        const user = await this.model
            .findOne({ name: username, isActive: true })
            .lean();

        return !!user;
    }

    async getName(user: Types.ObjectId) {
        const found = await this.model
            .findById({ _id: user })
            .select('name')
            .lean();

        return found?.name ?? 'N/A';
    }
}
