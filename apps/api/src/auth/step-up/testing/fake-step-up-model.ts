/**
 * In-memory stand-in for the StepUp model (#310): `updateOne` with upsert,
 * `exists(...).session()` and `deleteMany`, with the filters
 * StepUpService and RefreshTokenService build. Test-only.
 */
import { Types } from 'mongoose';
import { matches } from '../../refresh-token/testing/fake-refresh-token-model';

export interface StoredStepUp {
    user: Types.ObjectId;
    sid: string;
    expiresAt: Date;
}

type Filter = Record<string, unknown>;

export class FakeStepUpModel {
    rows: StoredStepUp[] = [];

    /** Records a step-up directly, as a prior re-auth would have. */
    seed(user: string | Types.ObjectId, sid: string, expiresAt: Date) {
        this.rows.push({ user: new Types.ObjectId(user), sid, expiresAt });
    }

    updateOne = jest.fn(
        (filter: { user: Types.ObjectId; sid: string }, update: Filter) => {
            const set = (update.$set ?? {}) as { expiresAt: Date };
            const hit = this.rows.find((row) => matches(row, filter));
            if (hit) hit.expiresAt = set.expiresAt;
            else this.rows.push({ ...filter, expiresAt: set.expiresAt });
            return Promise.resolve({ acknowledged: true });
        },
    );

    exists = jest.fn((filter: Filter) => {
        const query = Promise.resolve().then(() =>
            this.rows.some((row) => matches(row, filter)) ? {} : null,
        );
        return Object.assign(query, { session: () => query });
    });

    deleteMany = jest.fn((filter: Filter) => {
        const before = this.rows.length;
        this.rows = this.rows.filter((row) => !matches(row, filter));
        return Promise.resolve({ deletedCount: before - this.rows.length });
    });
}
