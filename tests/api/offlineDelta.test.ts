import { describe, it, expect } from "vitest";
import { createGraph, ApiError } from "../../src";
import { edges, Transaction } from "../types";
import { baseEntities } from "../shared";

describe("Offline Delta Queue & ApiError Handling", () => {
    it("allows chaining node.load() to return the loaded node", async () => {
        const apiGraph = createGraph({
            entities: structuredClone(baseEntities),
            edges,
            api: {
                transaction: {
                    read: async (id) => {
                        return { id, subcategoryId: "sub_loaded" } as Transaction;
                    }
                }
            }
        });

        const ghostNode = apiGraph.transaction("tx_ghost");
        expect(ghostNode.exists()).toBe(false);

        const loadedNode = await ghostNode.load();
        expect(loadedNode.exists()).toBe(true);
        expect(loadedNode.value()?.subcategoryId).toBe("sub_loaded");
        expect(loadedNode.value()?.id).toBe("tx_ghost");
    });

    it("allows chaining list.load() to return the loaded list", async () => {
        const apiGraph = createGraph({
            entities: { ...structuredClone(baseEntities), transaction: [] },
            edges,
            api: {
                transaction: {
                    list: async () => {
                        return [
                            { id: "tx_10", subcategoryId: "sub1" },
                            { id: "tx_11", subcategoryId: "sub2" }
                        ] as Transaction[];
                    }
                }
            }
        });

        const list = await apiGraph.transactionNodes().load();
        expect(list.ids()).toEqual(["tx_10", "tx_11"]);
        expect(list.entities().length).toBe(2);
    });

    it("retains local optimistic update and queues pending delta when handler returns explicit ApiError", async () => {
        let attempts = 0;
        const apiGraph = createGraph({
            entities: structuredClone(baseEntities),
            edges,
            api: {
                transaction: {
                    update: async (data) => {
                        attempts++;
                        if (attempts === 1) {
                            return { message: "Network unavailable", code: 503 } as ApiError;
                        }
                        return data;
                    }
                }
            }
        });

        const err = await apiGraph.transaction("tx1").update((tx) => ({ ...tx, amount: 999 }));
        expect((err as ApiError).message).toBe("Network unavailable");

        // Local state should retain optimistic update
        expect(apiGraph.transaction("tx1").value()?.amount).toBe(999);

        // Pending queue should contain delta
        const pending = apiGraph.pendingChanges();
        expect(pending.length).toBe(1);
        expect(pending[0].op).toBe("update");
        expect(pending[0].entityType).toBe("transaction");
        expect(pending[0].data.amount).toBe(999);

        // Flush pending deltas once network recovers
        const flushResult = await apiGraph.flushPending();
        expect(flushResult.synced.length).toBe(1);
        expect(flushResult.failed.length).toBe(0);
        expect(apiGraph.pendingChanges().length).toBe(0);
    });

    it("retains local optimistic delete and queues pending delta when handler returns explicit ApiError", async () => {
        let attempts = 0;
        const apiGraph = createGraph({
            entities: structuredClone(baseEntities),
            edges,
            api: {
                transaction: {
                    delete: async (id) => {
                        attempts++;
                        if (attempts === 1) {
                            return { message: "Server offline", code: 500 } as ApiError;
                        }
                    }
                }
            }
        });

        expect(apiGraph.transaction("tx1").exists()).toBe(true);
        const err = await apiGraph.transaction("tx1").delete();
        expect((err as ApiError).message).toBe("Server offline");

        expect(apiGraph.transaction("tx1").exists()).toBe(false);

        expect(apiGraph.pendingChanges().length).toBe(1);
        expect(apiGraph.pendingChanges()[0].op).toBe("delete");

        // Flush resolves delete on server
        const flushResult = await apiGraph.flushPending();
        expect(flushResult.synced.length).toBe(1);
        expect(apiGraph.pendingChanges().length).toBe(0);
    });

    it("supports optimistic create with temporary ID when handler returns ApiError", async () => {
        let attempts = 0;
        const apiGraph = createGraph({
            entities: structuredClone(baseEntities),
            edges,
            api: {
                transaction: {
                    create: async (data) => {
                        attempts++;
                        if (attempts === 1) {
                            return { message: "Offline create", isTransient: true } as ApiError;
                        }
                        return { id: "tx_server_99", ...data } as Transaction;
                    }
                }
            }
        });

        const node = await apiGraph.createTransaction({ subcategoryId: "sub1", amount: 50 });
        const tempId = node.value()?.id;
        expect(tempId).toBeDefined();
        expect(tempId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        expect(apiGraph.transaction(tempId!).exists()).toBe(true);

        expect(apiGraph.pendingChanges().length).toBe(1);
        expect(apiGraph.pendingChanges()[0].op).toBe("create");

        const flushResult = await apiGraph.flushPending();
        expect(flushResult.synced.length).toBe(1);
        expect(apiGraph.pendingChanges().length).toBe(0);
        expect(apiGraph.transaction("tx_server_99").exists()).toBe(true);
    });

    it("rolls back local changes when non-transient error (isTransient: false) occurs", async () => {
        const apiGraph = createGraph({
            entities: structuredClone(baseEntities),
            edges,
            api: {
                transaction: {
                    update: async () => {
                        return { message: "Validation error: invalid amount", isTransient: false } as ApiError;
                    }
                }
            }
        });

        const initialAmount = apiGraph.transaction("tx1").value()?.amount;
        const err = (await apiGraph.transaction("tx1").update((tx) => ({ ...tx, amount: -500 }))) as ApiError;
        expect(err.message).toBe("Validation error: invalid amount");

        expect(apiGraph.transaction("tx1").value()?.amount).toBe(initialAmount);
        expect(apiGraph.pendingChanges().length).toBe(0);
    });

    it("supports clearPending() to clear queued deltas", async () => {
        const apiGraph = createGraph({
            entities: structuredClone(baseEntities),
            edges,
            api: {
                transaction: {
                    delete: async () => {
                        return { message: "Offline", isTransient: true } as ApiError;
                    }
                }
            }
        });

        await apiGraph.transaction("tx1").delete();
        expect(apiGraph.pendingChanges().length).toBe(1);

        apiGraph.clearPending();
        expect(apiGraph.pendingChanges().length).toBe(0);
    });

    it("automatically classifies HTTP 4xx as non-transient (rollback) and HTTP 5xx / 0 as transient (queued)", async () => {
        const apiGraph = createGraph({
            entities: structuredClone(baseEntities),
            edges,
            api: {
                transaction: {
                    update: async (data) => {
                        if (data.amount === 404) {
                            return { message: "Not found", status: 404 } as ApiError;
                        }
                        if (data.amount === 503) {
                            return { message: "Service unavailable", status: 503 } as ApiError;
                        }
                        return data;
                    }
                }
            }
        });

        // 404 -> non-transient -> rollback & return error
        const err404 = (await apiGraph.transaction("tx1").update((tx) => ({ ...tx, amount: 404 }))) as ApiError;
        expect(err404.status).toBe(404);
        expect(err404.isTransient).toBe(false);
        expect(apiGraph.pendingChanges().length).toBe(0);

        // 503 -> transient -> queue & return error
        const err503 = (await apiGraph.transaction("tx1").update((tx) => ({ ...tx, amount: 503 }))) as ApiError;
        expect(err503.status).toBe(503);
        expect(err503.isTransient).toBe(true);
        expect(apiGraph.pendingChanges().length).toBe(1);
    });

    it("supports custom isTransientError predicate in ValidApi options", async () => {
        const apiGraph = createGraph({
            entities: structuredClone(baseEntities),
            edges,
            api: {
                isTransientError: (err) => err.code === "RETRY_ME",
                transaction: {
                    update: async () => {
                        return { message: "Custom failure", code: "RETRY_ME" } as ApiError;
                    }
                }
            }
        });

        const err = (await apiGraph.transaction("tx1").update((tx) => ({ ...tx, amount: 777 }))) as ApiError;
        expect(err.isTransient).toBe(true);
        expect(apiGraph.pendingChanges().length).toBe(1);
    });
});
