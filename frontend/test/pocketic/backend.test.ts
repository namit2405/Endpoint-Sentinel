import { createIdentity, PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";

let pic: PocketIc | undefined;
let actor: _SERVICE;

beforeAll(async () => {
  pic = await PocketIc.create(PIC_URL);
  ({ actor } = await pic.setupCanister<_SERVICE>({ idlFactory, wasm: BACKEND_WASM }));
});

afterAll(async () => {
  await pic?.tearDown();
});

describe("Endpoint Security Dashboard backend", () => {
  it("answers an empty-state read instead of trapping", async () => {
    // Anonymous callers are treated as guests without being registered.
    await expect(actor.getCallerUserRole()).resolves.toEqual({ guest: null });
    await expect(actor.isCallerAdmin()).resolves.toBe(false);
  });

  it("exposes an empty schema and rejects queries against unknown entities", async () => {
    // The bare template exposes no OQL entities, so the schema is an empty
    // entity list.
    const schema = await actor.schema();
    expect(schema).toBe('{"entities":[]}');
    // A well-formed query (with the required `start`) still has no entity to
    // run against, so it is rejected rather than returning a bogus result.
    await expect(actor.execute('{"start":"endpoint"}')).rejects.toThrow(/unknown entity/);
  });

  it("round-trips a caller role assignment through the real canister", async () => {
    const caller = createIdentity("admin-seed").getPrincipal();
    actor.setPrincipal(caller);
    // The access-control contract requires the caller to be registered before
    // a role can be assigned; the first registered caller becomes admin.
    await expect(actor._initialize_access_control()).resolves.toBeNull();
    await expect(actor.assignCallerUserRole(caller, { admin: null })).resolves.toBeNull();
    expect(await actor.getCallerUserRole()).toEqual({ admin: null });
    expect(await actor.isCallerAdmin()).toBe(true);
  });

  it("does not leak one caller's role to another", async () => {
    const admin = createIdentity("admin-seed").getPrincipal();
    const other = createIdentity("other-seed").getPrincipal();

    // Register both callers: the first becomes admin, the second a user.
    actor.setPrincipal(admin);
    await actor._initialize_access_control();
    actor.setPrincipal(other);
    await actor._initialize_access_control();

    // Roles are per-caller: `other` is a user, not an admin.
    actor.setPrincipal(other);
    expect(await actor.getCallerUserRole()).toEqual({ user: null });
    expect(await actor.isCallerAdmin()).toBe(false);

    // Admin promotes `other`; only `other`'s role changes, not admin's.
    actor.setPrincipal(admin);
    await actor.assignCallerUserRole(other, { admin: null });
    actor.setPrincipal(other);
    expect(await actor.getCallerUserRole()).toEqual({ admin: null });
    expect(await actor.isCallerAdmin()).toBe(true);
    actor.setPrincipal(admin);
    expect(await actor.isCallerAdmin()).toBe(true);
  });

  it("initializes access control and starts/finishes an II sign-in without trapping", async () => {
    actor.setPrincipal(createIdentity("signin-seed").getPrincipal());
    await expect(actor._initialize_access_control()).resolves.toBeNull();
    const start = await actor._internet_identity_sign_in_start();
    expect(start).toBeInstanceOf(Uint8Array);
    // A fresh sign-in has no stored nonce, so finishing it reports an error
    // rather than trapping.
    const finish = await actor._internet_identity_sign_in_finish();
    expect(finish).toHaveProperty("err");
  });
});
