import { describe, it, expect } from "vitest";
import { createGraph, GraphDef, ValidApi, ApiError, ApiGraphEvent } from "../../src";
import { edges, Transaction, Subcategory, MainCategory, ExpenseType, IncomeType, Schema } from "../types";
import { baseEntities } from "../shared";

describe("API-Bound Graph Wrapper (Handlers)", () => {
    it("handles optimistic update and automatic transaction rollback on failure", async () => {
        let shouldFail = false;
        let handlerCalled = 0;

        const apiGraph = createGraph({
            entities: structuredClone(baseEntities),
            edges,
            api: {
                transaction: {
                    update: async (data) => {
                        handlerCalled++;
                        if (shouldFail) {
                            throw new Error("Network Error");
                        }
                        return data;
                    },
                },
            },
        });

        await apiGraph.transaction("tx1").update((tx) => ({ ...tx, subcategoryId: "sub2" }));
        expect(apiGraph.transaction("tx1").value()?.subcategoryId).toBe("sub2");
        expect(handlerCalled).toBe(1);

        shouldFail = true;
        const err = await apiGraph.transaction("tx1").update((tx) => ({ ...tx, subcategoryId: "sub3" }));
        expect(err).toEqual(expect.objectContaining({ message: "Network Error" }));
        expect(handlerCalled).toBe(2);
    });

    it("handles optimistic delete and automatic transaction rollback on failure", async () => {
        let shouldFail = false;
        let handlerCalled = 0;

        const apiGraph = createGraph({
            entities: structuredClone(baseEntities),
            edges,
            api: {
                transaction: {
                    delete: async (id) => {
                        handlerCalled++;
                        if (shouldFail) {
                            throw new Error("Network Error");
                        }
                    },
                },
            },
        });

        expect(apiGraph.transaction("tx3").exists()).toBe(true);
        await apiGraph.transaction("tx3").delete();
        expect(apiGraph.transaction("tx3").exists()).toBe(false);
        expect(handlerCalled).toBe(1);

        shouldFail = true;
        expect(apiGraph.transaction("tx2").exists()).toBe(true);
        const err = await apiGraph.transaction("tx2").delete();
        expect(err).toEqual(expect.objectContaining({ message: "Network Error" }));
        expect(handlerCalled).toBe(2);
    });

    it("supports create operations", async () => {
        let handlerCalled = 0;
        const apiGraph = createGraph({
            entities: structuredClone(baseEntities),
            edges,
            api: {
                transaction: {
                    create: async (data) => {
                        handlerCalled++;
                        return { id: "tx_new", subcategoryId: data.subcategoryId };
                    },
                },
            },
        });
        const node = await apiGraph.createTransaction({ subcategoryId: "sub1" });

        expect(node.value()?.id).toBe("tx_new");
        expect(node.value()?.subcategoryId).toBe("sub1");
        expect(apiGraph.transaction("tx_new").exists()).toBe(true);
        expect(handlerCalled).toBe(1);
    });

    it("supports root-level update helpers like updateTransaction(data)", async () => {
        let updateCalledWith: any = null;

        const apiGraph = createGraph({
            entities: structuredClone(baseEntities),
            edges,
            api: {
                transaction: {
                    update: async (data) => {
                        updateCalledWith = data;
                        return data;
                    },
                },
            },
        });

        await apiGraph.updateTransaction({
            id: "tx1",
            subcategoryId: "sub2",
            amount: 75,
        });

        expect(updateCalledWith).toEqual({
            id: "tx1",
            subcategoryId: "sub2",
            amount: 75,
        });
        expect(apiGraph.transaction("tx1").value()?.subcategoryId).toBe("sub2");
    });

    it("supports lazy loading a missing node via load()", async () => {
        let handlerCalled = 0;
        const apiGraph = createGraph({
            entities: structuredClone(baseEntities),
            edges,
            api: {
                transaction: {
                    read: async (id) => {
                        handlerCalled++;
                        if (id === "tx_ghost") {
                            return { id: "tx_ghost", subcategoryId: "sub2" };
                        }
                        throw new Error("Not Found");
                    },
                },
            },
        });
        const ghostNode = apiGraph.transaction("tx_ghost");

        expect(ghostNode.exists()).toBe(false);
        await ghostNode.load();
        expect(ghostNode.exists()).toBe(true);
        expect(ghostNode.value()?.subcategoryId).toBe("sub2");
        expect(handlerCalled).toBe(1);
    });

    it("handles list fetch and query caching (without params)", async () => {
        let requestCount = 0;

        const apiGraph = createGraph({
            entities: {
                transaction: [] as Transaction[],
                subcategory: [] as Subcategory[],
                mainCategory: [] as MainCategory[],
                expenseType: [] as ExpenseType[],
                incomeType: [] as IncomeType[],
            },
            edges,
            api: {
                transaction: {
                    list: async () => {
                        requestCount++;
                        return [
                            { id: "t1", subcategoryId: "sub1" },
                            { id: "t2", subcategoryId: "sub1" },
                        ] as Transaction[];
                    },
                },
            },
        });

        const list1 = await apiGraph.transactionNodes().load();
        expect(list1.ids()).toEqual(["t1", "t2"]);
        expect(requestCount).toBe(1);

        const list1Cache = await apiGraph.transactionNodes().load();
        expect(list1Cache.ids()).toEqual(["t1", "t2"]);
        expect(requestCount).toBe(1);
    });

    it("respects custom node actions", async () => {
        const apiGraph = createGraph({
            entities: structuredClone(baseEntities),
            edges,
            api: {
                transaction: {
                    actions: {
                        archive: async (node) => {
                            await node.update((tx) => ({ ...tx, archived: true }));
                            return { ok: true };
                        },
                    },
                },
            },
        });

        const node = apiGraph.transaction("tx1");
        const res = await node.api.archive();

        expect(res).toEqual({ ok: true });
        expect(node.value()?.archived).toBe(true);
    });

    it("respects root-level graph actions", async () => {
        const apiGraph = createGraph({
            entities: structuredClone(baseEntities),
            edges,
            api: {
                actions: {
                    batchImport: async (graph, data: any[]) => {
                        graph.sync({ transaction: data }, { mode: "merge" });
                        return { imported: data.length };
                    },
                },
            },
        });

        const res = await apiGraph.api.batchImport([
            { id: "tx_batch_1", subcategoryId: "sub1" },
            { id: "tx_batch_2", subcategoryId: "sub2" },
        ]);

        expect(res).toEqual({ imported: 2 });
        expect(apiGraph.transaction("tx_batch_1").exists()).toBe(true);
        expect(apiGraph.transaction("tx_batch_2").exists()).toBe(true);
    });
    it("supports ValidApi for type-safe external configuration", async () => {
        type ArrayToSingularMap<T> = { [K in keyof T]: T[K] extends (infer U)[] ? U : T[K] };
        type MyGraphDef = GraphDef<ArrayToSingularMap<typeof baseEntities>, typeof edges>;

        const apiOptions = {
            transaction: {
                create: async (data) => {
                    return { id: "tx_external", subcategoryId: data.subcategoryId } as Transaction;
                },
            },
            actions: {
                customGraphAction: async (graph, value: string) => {
                    return `external-${value}`;
                },
            },
        } satisfies ValidApi<MyGraphDef>;

        const apiGraph = createGraph({
            entities: structuredClone(baseEntities),
            edges,
            api: apiOptions,
        });

        const node = await apiGraph.createTransaction({ subcategoryId: "sub1" });
        expect(node.value()?.id).toBe("tx_external");

        const actionResult = await apiGraph.api.customGraphAction("test");
        expect(actionResult).toBe("external-test");
    });

    it("ensures id parameters and fetch return types are strictly typed in ValidApi", async () => {
        type MyGraphDef = GraphDef<Schema, typeof edges>;

        const validConfig: ValidApi<MyGraphDef> = {
            transaction: {
                read: async (id: string) => {
                    return { id, subcategoryId: "sub1" } as Transaction;
                },
                list: async () => {
                    return [{ id: "tx1", subcategoryId: "sub1" }] as Transaction[];
                },
                update: async (data) => {
                    return data as Transaction;
                },
                delete: async (id: string) => {},
            },
        };

        const apiGraph = createGraph<MyGraphDef>({
            entities: structuredClone(baseEntities),
            edges,
            api: validConfig,
        });

        await apiGraph.transaction("tx1").load();
        expect(apiGraph.transaction("tx1").value()?.id).toBe("tx1");
    });

    it("passes entity data to update handler", async () => {
        let updateCalledWith: any = null;

        type MyGraphDef = GraphDef<Schema, typeof edges>;

        const apiGraph = createGraph<MyGraphDef>({
            entities: structuredClone(baseEntities),
            edges,
            api: {
                transaction: {
                    update: async (data) => {
                        updateCalledWith = { data };
                        return undefined;
                    },
                },
            },
        });

        await apiGraph.transaction("tx1").update((tx) => ({ ...tx, amount: 99 }));
        expect(updateCalledWith).toEqual({
            data: { id: "tx1", subcategoryId: "sub1", amount: 99 },
        });
        expect(updateCalledWith.data.id).toBe("tx1");
    });

    it("includes pending deltas in full graph snapshot and restores them via restore()", async () => {
        const apiGraph = createGraph({
            entities: structuredClone(baseEntities),
            edges,
            api: {
                transaction: {
                    delete: async () => {
                        return { message: "Offline", isTransient: true } as ApiError;
                    },
                },
            },
        });

        await apiGraph.transaction("tx1").delete();
        expect(apiGraph.pendingChanges().length).toBe(1);

        const snap = apiGraph.snapshot();
        expect(snap.entities).toBeDefined();
        expect(snap.pendingDeltas.length).toBe(1);
        expect(snap.pendingDeltas[0].op).toBe("delete");

        const freshGraph = createGraph({
            entities: { ...structuredClone(baseEntities), transaction: [] as Transaction[] },
            edges,
            api: {},
        });
        expect(freshGraph.pendingChanges().length).toBe(0);

        freshGraph.restore(snap);
        expect(freshGraph.pendingChanges().length).toBe(1);
        expect(freshGraph.pendingChanges()[0].op).toBe("delete");
    });

    describe("Multi-Entity API Transactions (tx.commit() and tx.rollback())", () => {
        it("stages multiple entity mutations in a transaction and pushes them on commit()", async () => {
            const updatedTransactions: any[] = [];
            const updatedSubcategories: any[] = [];

            const apiGraph = createGraph({
                entities: structuredClone(baseEntities),
                edges,
                api: {
                    transaction: {
                        update: async (data) => {
                            updatedTransactions.push(data);
                        },
                    },
                    subcategory: {
                        update: async (data) => {
                            updatedSubcategories.push(data);
                        },
                    },
                },
            });

            const tx = apiGraph.beginTransaction();
            await tx.transaction("tx1").update((t) => ({ ...t, subcategoryId: "sub2" }));
            await tx.subcategory("sub1").update((s) => ({ ...s, name: "Renamed Sub" }));

            expect(apiGraph.transaction("tx1").value()?.subcategoryId).toBe("sub1");
            expect(tx.transaction("tx1").value()?.subcategoryId).toBe("sub2");
            expect(updatedTransactions.length).toBe(0);

            const res = await tx.commit();
            expect(res.success).toBe(true);
            expect(updatedTransactions.length).toBe(1);
            expect(updatedSubcategories.length).toBe(1);
            expect(apiGraph.transaction("tx1").value()?.subcategoryId).toBe("sub2");
            expect(apiGraph.subcategory("sub1").value()?.name).toBe("Renamed Sub");
        });

        it("discards uncommitted changes on rollback() without sending network requests", async () => {
            let apiCalled = false;
            const apiGraph = createGraph({
                entities: structuredClone(baseEntities),
                edges,
                api: {
                    transaction: {
                        update: async () => {
                            apiCalled = true;
                        },
                    },
                },
            });

            const tx = apiGraph.beginTransaction();
            await tx.transaction("tx1").update((t) => ({ ...t, subcategoryId: "sub2" }));
            tx.rollback();

            expect(apiCalled).toBe(false);
            expect(apiGraph.transaction("tx1").value()?.subcategoryId).toBe("sub1");
        });

        it("rolls back local changes when commit() encounters a permanent server error", async () => {
            const apiGraph = createGraph({
                entities: structuredClone(baseEntities),
                edges,
                api: {
                    transaction: {
                        update: async () => {
                            return { message: "Validation error", status: 400, isTransient: false } as ApiError;
                        },
                    },
                },
            });

            const tx = apiGraph.beginTransaction();
            await tx.transaction("tx1").update((t) => ({ ...t, subcategoryId: "sub2" }));

            const res = await tx.commit();
            expect(res.success).toBe(false);
            expect(res.error?.status).toBe(400);

            expect(apiGraph.transaction("tx1").value()?.subcategoryId).toBe("sub1");
        });

        it("supports nested transactions — inner commit merges into outer transaction without HTTP calls", async () => {
            const updatedTransactions: any[] = [];
            const apiGraph = createGraph({
                entities: structuredClone(baseEntities),
                edges,
                api: {
                    transaction: {
                        update: async (data) => {
                            updatedTransactions.push(data);
                        },
                    },
                },
            });

            const txOuter = apiGraph.beginTransaction();
            const txInner = txOuter.beginTransaction();

            await txInner.transaction("tx1").update((t) => ({ ...t, subcategoryId: "sub_inner" }));
            expect(txInner.transaction("tx1").value()?.subcategoryId).toBe("sub_inner");

            const innerRes = await txInner.commit();
            expect(innerRes.success).toBe(true);
            expect(updatedTransactions.length).toBe(0);
            expect(txOuter.transaction("tx1").value()?.subcategoryId).toBe("sub_inner");
            expect(apiGraph.transaction("tx1").value()?.subcategoryId).toBe("sub1");

            const outerRes = await txOuter.commit();
            expect(outerRes.success).toBe(true);
            expect(updatedTransactions.length).toBe(1);
            expect(apiGraph.transaction("tx1").value()?.subcategoryId).toBe("sub_inner");
        });

        it("handles concurrent transactions independently", async () => {
            const callLog: string[] = [];
            const apiGraph = createGraph({
                entities: structuredClone(baseEntities),
                edges,
                api: {
                    transaction: {
                        update: async (data) => {
                            callLog.push(data.subcategoryId);
                        },
                    },
                },
            });

            const txA = apiGraph.beginTransaction();
            const txB = apiGraph.beginTransaction();

            await txA.transaction("tx1").update((t) => ({ ...t, subcategoryId: "subA" }));
            await txB.transaction("tx1").update((t) => ({ ...t, subcategoryId: "subB" }));

            expect(txA.transaction("tx1").value()?.subcategoryId).toBe("subA");
            expect(txB.transaction("tx1").value()?.subcategoryId).toBe("subB");
            expect(apiGraph.transaction("tx1").value()?.subcategoryId).toBe("sub1");

            await txA.commit();
            expect(apiGraph.transaction("tx1").value()?.subcategoryId).toBe("subA");

            await txB.commit();
            expect(apiGraph.transaction("tx1").value()?.subcategoryId).toBe("subB");
            expect(callLog).toEqual(["subA", "subB"]);
        });
    });

    describe("Event Subscriptions & Auto-Flush", () => {
        it("emits events with rich metadata payloads to subscribers", async () => {
            const emittedEvents: ApiGraphEvent[] = [];
            const apiGraph = createGraph({
                entities: structuredClone(baseEntities),
                edges,
                api: {
                    transaction: {
                        update: async (data) => {
                            if (data.subcategoryId === "fail") {
                                return { message: "Permanent Error", status: 400, isTransient: false } as ApiError;
                            }
                            return data;
                        },
                    },
                },
            });

            const unsubscribe = apiGraph.subscribe((evt) => {
                emittedEvents.push(evt);
            });

            await apiGraph.transaction("tx1").update((t) => ({ ...t, subcategoryId: "sub2" }));
            const changeEvt = emittedEvents.find((e) => e.type === "change");
            expect(changeEvt).toBeDefined();

            await apiGraph.transaction("tx1").update((t) => ({ ...t, subcategoryId: "fail" }));
            const errorEvt = emittedEvents.find((e) => e.type === "error") as any;
            expect(errorEvt).toBeDefined();
            expect(errorEvt.error.status).toBe(400);
            expect(errorEvt.op).toBe("update");
            expect(errorEvt.entityType).toBe("transaction");
            expect(errorEvt.entityId).toBe("tx1");

            const rollbackEvt = emittedEvents.find((e) => e.type === "rollback") as any;
            expect(rollbackEvt).toBeDefined();
            expect(rollbackEvt.error.message).toBe("Permanent Error");

            unsubscribe();
        });

        it("automatically flushes pending deltas on a timer interval", async () => {
            let flushCount = 0;
            const apiGraph = createGraph({
                entities: structuredClone(baseEntities),
                edges,
                api: {
                    transaction: {
                        delete: async () => {
                            flushCount++;
                            if (flushCount === 1) {
                                return { message: "Offline", isTransient: true } as ApiError;
                            }
                            return undefined;
                        },
                    },
                },
            });

            await apiGraph.transaction("tx1").delete();
            expect(apiGraph.pendingChanges().length).toBe(1);

            const stop = apiGraph.startAutoFlush({ intervalMs: 30, onOnline: false });

            await new Promise((resolve) => setTimeout(resolve, 80));

            stop();
            expect(apiGraph.pendingChanges().length).toBe(0);
            expect(flushCount).toBeGreaterThanOrEqual(2);
        });
    });

    describe("Temporary-to-Server ID Remapping", () => {
        it("remaps temp ID to server ID and resolves original ID lookups", async () => {
            const apiGraph = createGraph({
                entities: structuredClone(baseEntities),
                edges,
                api: {
                    subcategory: {
                        create: async () => {
                            return {
                                id: "real_sub_99",
                                name: "Groceries",
                                mainCategoryId: "mc1",
                                expenseTypeId: "exp1",
                            } as Subcategory;
                        },
                    },
                },
            });

            const node = await apiGraph.createSubcategory({
                id: "temp_sub_1",
                name: "Temp Groceries",
                mainCategoryId: "mc1",
            });

            expect(node.value()?.id).toBe("real_sub_99");

            expect(apiGraph.resolveId("temp_sub_1")).toBe("real_sub_99");
            expect(apiGraph.getOriginalId("real_sub_99")).toBe("temp_sub_1");

            expect(apiGraph.subcategory("temp_sub_1").value()?.name).toBe("Groceries");
            expect(apiGraph.subcategory("real_sub_99").value()?.name).toBe("Groceries");
        });

        it("remaps foreign keys across graph entities and queued deltas during flushPending()", async () => {
            let isOffline = true;
            const apiGraph = createGraph({
                entities: structuredClone(baseEntities),
                edges,
                api: {
                    subcategory: {
                        create: async (data) => {
                            if (isOffline) {
                                return { message: "Offline", isTransient: true } as ApiError;
                            }
                            return {
                                id: "real_sub_100",
                                name: data.name,
                                mainCategoryId: "mc1",
                            } as Subcategory;
                        },
                    },
                    transaction: {
                        update: async (data) => {
                            if (isOffline) {
                                return { message: "Offline", isTransient: true } as ApiError;
                            }
                            return data;
                        },
                    },
                },
            });

            await apiGraph.createSubcategory({
                id: "temp_sub_offline",
                name: "Offline Sub",
                mainCategoryId: "mc1",
            });

            await apiGraph.transaction("tx1").update((tx) => ({ ...tx, subcategoryId: "temp_sub_offline" }));

            expect(apiGraph.transaction("tx1").value()?.subcategoryId).toBe("temp_sub_offline");
            expect(apiGraph.pendingChanges().length).toBe(2);

            isOffline = false;
            const res = await apiGraph.flushPending();

            expect(res.synced.length).toBe(2);
            expect(apiGraph.resolveId("temp_sub_offline")).toBe("real_sub_100");
            expect(apiGraph.transaction("tx1").value()?.subcategoryId).toBe("real_sub_100");
        });
    });
});
