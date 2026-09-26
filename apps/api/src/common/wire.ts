import type { Types } from 'mongoose';

/**
 * The JSON a value of type `T` is sent as: a `Date` becomes its ISO string
 * and an `ObjectId` its hex string (both through their `toJSON`), and
 * methods are dropped. Everything else keeps its type.
 */
export type Jsonify<T> = T extends Date | Types.ObjectId
    ? string
    : T extends readonly (infer U)[]
      ? Jsonify<U>[]
      : T extends object
        ? {
              [
                  K in keyof T as T[K] extends (...args: never[]) => unknown
                      ? never
                      : K
              ]: Jsonify<T[K]>;
          }
        : T;

/**
 * Types a handler's result as the JSON Nest will send for it (issue #27).
 * The identity at runtime: Nest serialises the value itself. Declaring the
 * handler's return type as the contracts wire type then makes the compiler
 * check the service's result against the contract:
 *
 *     async getAll(...): Promise<Paginated<SaleRow>> {
 *         return asJson(await this.service.getAll(user, dto));
 *     }
 *
 * The compiler checks the fields the contract names; a field the service
 * adds beyond them is caught by the wire drift spec (test/db).
 */
export function asJson<T>(value: T): Jsonify<T> {
    return value as unknown as Jsonify<T>;
}

/** A user or product reference populated with `select: 'name'`. */
export interface NameRef {
    _id: Types.ObjectId;
    name: string;
}
