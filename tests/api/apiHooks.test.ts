import { describe, it, expect, vi } from "vitest";
import { createGraph } from "../../src/index";
import { GraphDef, ValidSchema, GraphEdges } from "../../src/core/types";
import { ValidApi, ApiCallContext, ApiError, ApiGraphDef } from "../../src/api/types";

type User = { id: string; name: string; email?: string };
type Post = { id: string; userId: string; title: string };

type Schema = ValidSchema<{
    user: User;
    post: Post;
}>;

const edges = {
    post: {
        user: { bidirectional: true, resolve: (p) => p.userId },
    },
} as const satisfies GraphEdges<Schema>;

type AppGraphDef = GraphDef<Schema, typeof edges>;

describe("ApiGraph Lifecycle Hooks", () => {
    it("executes beforeCall hook and supports payload transformation", async () => {
        const createSpy = vi.fn(async (data: any) => ({
            id: "u1",
            name: data.name,
            email: data.email,
        }));

        const beforeCallSpy = vi.fn(async (ctx: ApiCallContext) => {
            if (ctx.op === "create" && ctx.entityType === "user") {
                return {
                    data: {
                        ...ctx.data,
                        email: `${ctx.data.name.toLowerCase()}@example.com`,
                    },
                };
            }
        });

        const api = {
            hooks: {
                beforeCall: beforeCallSpy,
            },
            user: {
                create: createSpy,
            },
        } as const satisfies ValidApi<AppGraphDef>;

        type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
        const graph = createGraph<CustomApiGraphDef>({ edges, api });
        const userNode = await graph.createUser({ name: "Alice" });

        expect(beforeCallSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                op: "create",
                entityType: "user",
                data: { name: "Alice" },
            }),
        );
        expect(createSpy).toHaveBeenCalledWith({
            name: "Alice",
            email: "alice@example.com",
        });
        expect(userNode.value()?.email).toBe("alice@example.com");
    });

    it("cancels API call when beforeCall returns false or { cancel: true }", async () => {
        const createSpy = vi.fn();
        const readSpy = vi.fn();

        const api = {
            hooks: {
                beforeCall: (ctx) => {
                    void ctx.op;
                    if (ctx.op === "create") return false;
                    if (ctx.op === "read") return { cancel: true };
                },
            },
            user: {
                create: createSpy,
                read: readSpy,
            },
        } as const satisfies ValidApi<AppGraphDef>;

        type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
        const graph = createGraph<CustomApiGraphDef>({ edges, api });

        const createResult = await graph.createUser({ name: "Bob" });
        expect(createSpy).not.toHaveBeenCalled();
        expect((createResult as unknown as ApiError).message).toContain("canceled by beforeCall hook");

        const readResult = await graph.user("u1").load();
        expect(readSpy).not.toHaveBeenCalled();
        expect((readResult as unknown as ApiError).message).toContain("canceled by beforeCall hook");
    });

    it("executes afterCall hook and supports response transformation", async () => {
        const readSpy = vi.fn(async (id: string) => ({
            id,
            name: "Raw User",
        }));

        const afterCallSpy = vi.fn((ctx: ApiCallContext & { result: any }) => {
            if (ctx.op === "read" && ctx.entityType === "user") {
                return {
                    ...ctx.result,
                    name: `${ctx.result.name} (Transformed)`,
                };
            }
        });

        const api = {
            hooks: {
                afterCall: afterCallSpy,
            },
            user: {
                read: readSpy,
            },
        } as const satisfies ValidApi<AppGraphDef>;

        type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
        const graph = createGraph<CustomApiGraphDef>({ edges, api });
        const node = await graph.user("u1").load();

        expect(afterCallSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                op: "read",
                entityType: "user",
                entityId: "u1",
                result: { id: "u1", name: "Raw User" },
            }),
        );
        expect((node as any).value()?.name).toBe("Raw User (Transformed)");
    });

    it("executes onError hook when API call fails", async () => {
        const updateSpy = vi.fn(async () => {
            throw new Error("Database connection lost");
        });

        const onErrorSpy = vi.fn((ctx: ApiCallContext & { error: ApiError }) => {
            return {
                ...ctx.error,
                message: `[Handled] ${ctx.error.message}`,
            };
        });

        const api = {
            hooks: {
                onError: onErrorSpy,
            },
            user: {
                update: updateSpy,
            },
        } as const satisfies ValidApi<AppGraphDef>;

        const entities = {
            user: [{ id: "u1", name: "Alice" }],
        };

        type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
        const graph = createGraph<CustomApiGraphDef>({ entities, edges, api });
        const res = await graph.user("u1").update((u) => ({ ...u, name: "Alice Updated" }));

        expect(onErrorSpy).toHaveBeenCalled();
        expect((res as unknown as ApiError).message).toBe("[Handled] Database connection lost");
    });

    it("executes onFinally hook on both success and failure", async () => {
        const finallyCalls: string[] = [];

        const api = {
            hooks: {
                onFinally: (ctx) => {
                    finallyCalls.push(`${ctx.op}:${ctx.error ? "error" : "success"}`);
                },
            },
            user: {
                create: async (data: any) => ({ id: "u1", ...data }),
                delete: async () => {
                    throw new Error("Cannot delete");
                },
            },
        } as const satisfies ValidApi<AppGraphDef>;

        const entities = {
            user: [{ id: "u1", name: "Alice" }],
        };

        type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
        const graph = createGraph<CustomApiGraphDef>({ entities, edges, api });

        await graph.createUser({ name: "Bob" });
        await graph.user("u1").delete();

        expect(finallyCalls).toEqual(["create:success", "delete:error"]);
    });

    it("supports entity-level hooks and dynamic addHook registration", async () => {
        const callOrder: string[] = [];

        const api = {
            hooks: {
                beforeCall: () => {
                    callOrder.push("global-before");
                },
            },
            user: {
                hooks: {
                    beforeCall: () => {
                        callOrder.push("entity-before");
                    },
                },
                list: async () => [{ id: "u1", name: "Alice" }],
            },
        } as const satisfies ValidApi<AppGraphDef>;

        type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
        const graph = createGraph<CustomApiGraphDef>({ edges, api });

        const unsubscribe = graph.meta.addHook({
            beforeCall: () => {
                callOrder.push("dynamic-before");
            },
        });

        await graph.userNodes().load();
        expect(callOrder).toEqual(["global-before", "entity-before", "dynamic-before"]);

        callOrder.length = 0;
        unsubscribe();

        await graph.userNodes().load({ force: true });
        expect(callOrder).toEqual(["global-before", "entity-before"]);
    });
});
