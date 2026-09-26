import type { Role } from '../roles.js';
import type { WireShape } from '../wire-shape.js';

/*
 * Wire types (issue #27): each response body as the JSON the API sends.
 * Ids are strings, timestamps ISO strings, and money integer centavos.
 */

/**
 * A user reference the API populated with its name only (`select: 'name'`).
 * Also a row of `GET /restocks/users` and `GET /adjustments/users`.
 */
export interface UserRef {
    _id: string;
    name: string;
}

export const USER_REF_SHAPE: WireShape<UserRef> = {
    _id: 'required',
    name: 'required',
};

/** A row of `GET /users`: never the password hash. */
export interface UserView {
    _id: string;
    name: string;
    roles: Role[];
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export const USER_VIEW_SHAPE: WireShape<UserView> = {
    _id: 'required',
    name: 'required',
    roles: 'required',
    isActive: 'required',
    createdAt: 'required',
    updatedAt: 'required',
};

/** `GET /users/profile`: the signed-in user, read from their access token. */
export interface ProfileView {
    /** Keys this cashier's saved basket on the client (#23). */
    userId: string;
    username: string;
    roles: Role[];
}

export const PROFILE_VIEW_SHAPE: WireShape<ProfileView> = {
    userId: 'required',
    username: 'required',
    roles: 'required',
};

/** `POST /auth/login`. The roles come from `GET /users/profile`. */
export interface LoginResponse {
    user: { username: string };
}

export const LOGIN_RESPONSE_SHAPE: WireShape<LoginResponse> = {
    user: 'required',
};
