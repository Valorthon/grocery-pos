/** Real, unhinted query plans for the history/dashboard access paths (#339). */
import { Types } from 'mongoose';
import { Role } from '../../src/auth/types';
import { dateRangeFilter } from '../../src/common/utils/timezone';
import { bootDbApp, caller, type DbApp } from './db-app';

interface Fixture {
    _id: Types.ObjectId;
    description: string;
    restockedBy?: Types.ObjectId;
    adjustedBy?: Types.ObjectId;
    purchaseOrder?: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
    [key: string]: unknown;
}
interface Explain {
    queryPlanner: { winningPlan: unknown };
    executionStats: {
        nReturned: number;
        totalDocsExamined: number;
        totalKeysExamined: number;
    };
}
function stages(value: unknown): string[] {
    if (!value || typeof value !== 'object') return [];
    if (Array.isArray(value)) return value.flatMap(stages);
    const record = value as Record<string, unknown>;
    return [
        ...(typeof record.stage === 'string' ? [record.stage] : []),
        ...Object.values(record).flatMap(stages),
    ];
}
function cursorExplain(value: unknown): Explain {
    if (!value || typeof value !== 'object') throw new Error('Missing plan');
    const record = value as Record<string, unknown>;
    if (record.queryPlanner && record.executionStats) return value as Explain;
    for (const child of Object.values(record)) {
        if (child && typeof child === 'object') {
            try {
                return cursorExplain(child);
            } catch {
                // Aggregation explains wrap the cursor in stages/$cursor.
            }
        }
    }
    throw new Error('Missing cursor execution stats');
}

const actorIds = Array.from({ length: 20 }, () => new Types.ObjectId());
const poIds = Array.from({ length: 25 }, () => new Types.ObjectId());
const start = Date.UTC(2024, 0, 1);
const dayMs = 86_400_000;
const dateFrom = '2025-02-04';
const dateTo = '2026-03-10';
const dates = dateRangeFilter(dateFrom, dateTo, 'Asia/Manila')!;
const admin = caller('history-index-admin', Role.Admin);

for (const [model, actor, route] of [
    ['Restock', 'restockedBy', '/restocks'],
    ['Adjustment', 'adjustedBy', '/adjustments'],
] as const) {
    describe(`${model} history query plans`, () => {
        let db: DbApp;
        let rows: Fixture[];
        beforeAll(async () => {
            db = await bootDbApp();
            await db.model(model).init();
            rows = Array.from({ length: 1_000 }, (_, i) => ({
                _id: new Types.ObjectId(),
                description: `History fixture ${i}`,
                [actor]: actorIds[i % actorIds.length],
                ...(model === 'Restock' && {
                    purchaseOrder: poIds[i % poIds.length],
                    totalCost: 100,
                }),
                createdAt: new Date(start + i * dayMs),
                updatedAt: new Date(start + i * dayMs),
            }));
            await db.model(model).collection.insertMany(rows);
        });
        afterAll(async () => db?.close());

        const cases: Array<{
            name: string;
            filter: {
                restockedBy?: Types.ObjectId;
                adjustedBy?: Types.ObjectId;
                purchaseOrder?: Types.ObjectId;
                createdAt?: typeof dates;
            };
            query: string;
        }> = [
            { name: 'newest five / dashboard', filter: {}, query: '' },
            {
                name: 'date only',
                filter: { createdAt: dates },
                query: `dateFrom=${dateFrom}&dateTo=${dateTo}`,
            },
            {
                name: 'actor and date',
                filter: { [actor]: actorIds[3], createdAt: dates },
                query: `${actor}=${actorIds[3].toString()}&dateFrom=${dateFrom}&dateTo=${dateTo}`,
            },
            ...(model === 'Restock'
                ? [
                      {
                          name: 'purchase order',
                          filter: { purchaseOrder: poIds[7] },
                          query: `purchaseOrder=${poIds[7].toString()}`,
                      },
                      {
                          name: 'purchase order and date',
                          filter: { purchaseOrder: poIds[7], createdAt: dates },
                          query: `purchaseOrder=${poIds[7].toString()}&dateFrom=${dateFrom}&dateTo=${dateTo}`,
                      },
                  ]
                : []),
        ];
        it.each(cases)(
            '$name uses ordered index access and retains exact totals',
            async ({ name, filter, query }) => {
                const collection = db.model(model).collection;
                const page = cursorExplain(
                    await collection
                        .find(filter)
                        .sort({ createdAt: -1 })
                        .limit(5)
                        .explain('executionStats'),
                );
                const count = cursorExplain(
                    await collection
                        .aggregate([{ $match: filter }, { $count: 'total' }])
                        .explain('executionStats'),
                );
                const pageStages = stages(page.queryPlanner.winningPlan);
                const countStages = stages(count.queryPlanner.winningPlan);
                console.info(`${model} ${name}`, {
                    pageStages,
                    pageDocs: page.executionStats.totalDocsExamined,
                    pageKeys: page.executionStats.totalKeysExamined,
                    countStages,
                    countDocs: count.executionStats.totalDocsExamined,
                    countKeys: count.executionStats.totalKeysExamined,
                });
                expect(pageStages).not.toContain('COLLSCAN');
                expect(pageStages).not.toContain('SORT');
                expect(page.executionStats.nReturned).toBe(5);
                expect(page.executionStats.totalDocsExamined).toBe(5);
                // An unfiltered exact total still reads the whole collection;
                // filtered totals can count index keys without fetching documents.
                if (Object.keys(filter).length) {
                    expect(countStages).not.toContain('COLLSCAN');
                    expect(count.executionStats.totalDocsExamined).toBe(0);
                }

                const expected = rows
                    .filter((row) => {
                        if (
                            filter[actor] &&
                            row[actor]?.toHexString() !==
                                filter[actor]?.toHexString()
                        )
                            return false;
                        if (
                            filter.purchaseOrder &&
                            row.purchaseOrder?.toHexString() !==
                                filter.purchaseOrder.toHexString()
                        )
                            return false;
                        return (
                            !filter.createdAt ||
                            (row.createdAt >= dates.$gte! &&
                                row.createdAt < dates.$lt!)
                        );
                    })
                    .sort(
                        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
                    );
                const response = await db.call(
                    admin,
                    'GET',
                    `${route}?page=1&limit=5&${query}`,
                );
                expect(response.status).toBe(200);
                const body = (await response.json()) as {
                    data: Array<{ _id: string }>;
                    totalItems: number;
                };
                expect(body.totalItems).toBe(expected.length);
                expect(body.data.map((row) => row._id)).toEqual(
                    expected.slice(0, 5).map((row) => row._id.toString()),
                );
            },
        );
    });
}
