import { BadRequestException, Logger } from '@nestjs/common';

export class MongoFilter {
    static catch(err: unknown) {
        switch (Number((err as { code?: unknown }).code)) {
            case 11000:
                this.duplicate(err);
                break;
            default:
                Logger.log('-> NOT CAUGHT BY SPECIFIC MONGO FILTER');
                throw err;
        }
    }

    private static duplicate(err: unknown) {
        Logger.log('-> DUPLICATE FILTER');
        const baseErrMsg = 'Already exsists';
        const getKey = (origMsg: string) =>
            origMsg.split('dup key: { ')[1].split(':')[0];

        const error = err as {
            name?: string;
            writeErrors?: Array<{
                err?: {
                    op?: { q?: { _id?: unknown }; _id?: unknown };
                    errmsg?: string;
                };
            }>;
            errorResponse?: { errmsg?: string };
        };

        if (error.name === 'MongoBulkWriteError') {
            Logger.log('==>> BulkWrite');

            const details = error.writeErrors?.map(({ err: writeErr }) => ({
                msg: baseErrMsg,
                _id: writeErr?.op?.q?._id ?? writeErr?.op?._id,
                property: getKey(writeErr?.errmsg ?? ''),
            }));

            throw new BadRequestException(details);
        } else if (error.name === 'MongoServerError') {
            Logger.log('==>> Server');

            const details = [
                {
                    msg: baseErrMsg,
                    property: getKey(error.errorResponse?.errmsg ?? ''),
                },
            ];

            throw new BadRequestException(details);
        } else {
            throw err;
        }
    }
}
