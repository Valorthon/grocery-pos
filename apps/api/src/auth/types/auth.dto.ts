import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { LoginRequest } from '@grocery-pos/contracts';
import { STRING_LIMITS } from '../../constants';

export class LoginDto implements LoginRequest {
    @IsString()
    @IsNotEmpty()
    @MaxLength(STRING_LIMITS.USERNAME)
    @Transform(({ value }) =>
        typeof value === 'string'
            ? value.trim().toLowerCase()
            : (value as unknown),
    )
    username!: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(STRING_LIMITS.PASSWORD)
    password!: string;
}
