// import {
//     CallHandler,
//     ExecutionContext,
//     Injectable,
//     InternalServerErrorException,
//     Logger,
//     NestInterceptor,
// } from '@nestjs/common';
// import { map, Observable } from 'rxjs';
// import { BaseResponse } from '../base/base.response';

// @Injectable()
// export class ResponseInterceptor<T> implements NestInterceptor<
//     T,
//     BaseResponse<T>
// > {
//     private readonly logger = new Logger(ResponseInterceptor.name, {
//         timestamp: true,
//     });

//     intercept(
//         context: ExecutionContext,
//         next: CallHandler<T>,
//     ): Observable<BaseResponse<T>> {
//         return next.handle().pipe(
//             map((data): BaseResponse<T> => {
//                 if (data instanceof BaseResponse) {
//                     return data as BaseResponse<T>;
//                 }

//                 this.logger.error(
//                     `data is not an instance of BaseResponse.\n` +
//                         `Check if:\n` +
//                         `\t>Controller: ${context.getClass().name} extends BaseController\n` +
//                         `\t>Handler: ${context.getHandler().name} returns formatResponse()`,
//                 );

//                 throw new InternalServerErrorException(
//                     'Invalid operation. If you think something is wrong, contact the developers.',
//                 );
//             }),
//         );
//     }
// }
