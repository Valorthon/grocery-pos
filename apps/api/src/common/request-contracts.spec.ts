import type {
    AdjustmentLineRequest,
    AdjustmentRequest,
    ChangePasswordRequest,
    CloseShiftRequest,
    CreateUserRequest,
    CreateUsersRequest,
    DiscountInput,
    DrawerMovementRequest,
    LoginRequest,
    NewProductRequest,
    NewProductsRequest,
    OpenShiftRequest,
    RestockLineFields,
    RestockRequest,
    ReverseSaleRequest,
    SaleLineRequest,
    SaleRequest,
    Tender,
    UpdateUsersRequest,
    UserUpdate,
    UserUpdateRequest,
} from '@grocery-pos/contracts';
import type { LoginDto } from '../auth/types';
import type { AdjustDto } from '../inventory-man/adjustment/types/adjustment.dto';
import type { RestockDto } from '../inventory-man/restock/types/restock.dto';
import type { NewProductsDto } from '../product/types/product.dto';
import type { ReverseSaleDto, SellDto } from '../sales/types/sales.dto';
import type {
    CloseShiftDto,
    DrawerMovementDto,
    OpenShiftDto,
} from '../shift/types/shift.dto';
import type {
    ChangePasswordDto,
    CreateBulkDto,
    UpdateBulkDto,
} from '../user/types/user.dto';

/*
 * Request contracts (issue #90). Each body DTO `implements` its contracts
 * type, so the compiler already refuses a DTO that lacks a required
 * contract field or types one differently. `implements` lets a class skip
 * an optional field and add fields of its own; `keysMatch` closes both
 * gaps: a key on one side only fails `tsc` (`pnpm typecheck`), naming it.
 */
type KeysMatch<Dto, Contract> = [
    Exclude<keyof Dto, keyof Contract>,
    Exclude<keyof Contract, keyof Dto>,
] extends [never, never]
    ? true
    : {
          onlyInDto: Exclude<keyof Dto, keyof Contract>;
          onlyInContract: Exclude<keyof Contract, keyof Dto>;
      };

function keysMatch<Dto, Contract>(ok: KeysMatch<Dto, Contract>) {
    return ok;
}

type Line<T extends readonly unknown[]> = T[number];

const checks = {
    LoginDto: keysMatch<LoginDto, LoginRequest>(true),
    CreateBulkDto: keysMatch<CreateBulkDto, CreateUsersRequest>(true),
    CreateFields: keysMatch<Line<CreateBulkDto['users']>, CreateUserRequest>(
        true,
    ),
    UpdateBulkDto: keysMatch<UpdateBulkDto, UpdateUsersRequest>(true),
    UpdateBulkFields: keysMatch<
        Line<UpdateBulkDto['updates']>,
        UserUpdateRequest
    >(true),
    UpdateFields: keysMatch<
        Line<UpdateBulkDto['updates']>['update'],
        UserUpdate
    >(true),
    ChangePasswordDto: keysMatch<ChangePasswordDto, ChangePasswordRequest>(
        true,
    ),
    SellDto: keysMatch<SellDto, SaleRequest>(true),
    SellDetailsFields: keysMatch<Line<SellDto['sellDetails']>, SaleLineRequest>(
        true,
    ),
    TenderFields: keysMatch<Line<SellDto['tenders']>, Tender>(true),
    DiscountFields: keysMatch<NonNullable<SellDto['discount']>, DiscountInput>(
        true,
    ),
    ReverseSaleDto: keysMatch<ReverseSaleDto, ReverseSaleRequest>(true),
    OpenShiftDto: keysMatch<OpenShiftDto, OpenShiftRequest>(true),
    CloseShiftDto: keysMatch<CloseShiftDto, CloseShiftRequest>(true),
    DrawerMovementDto: keysMatch<DrawerMovementDto, DrawerMovementRequest>(
        true,
    ),
    NewProductsDto: keysMatch<NewProductsDto, NewProductsRequest>(true),
    NewProductFields: keysMatch<
        Line<NewProductsDto['newProducts']>,
        NewProductRequest
    >(true),
    RestockDto: keysMatch<RestockDto, RestockRequest>(true),
    RestockFields: keysMatch<
        Line<RestockDto['restockDetails']>,
        RestockLineFields
    >(true),
    AdjustDto: keysMatch<AdjustDto, AdjustmentRequest>(true),
    AdjustFields: keysMatch<
        Line<AdjustDto['adjustDetails']>,
        AdjustmentLineRequest
    >(true),
};

describe('request contracts (#90)', () => {
    it('every body DTO has exactly the keys of its contracts type', () => {
        // The real check is the compiler's, above; this keeps the table used.
        expect(Object.values(checks).every((ok) => ok === true)).toBe(true);
    });
});
