import { describe, it, expect } from "vitest";
import {
    createGraph,
    ApiGraphDef,
    ValidApi,
    ApiError,
    ApiGraphEvent,
    ApiNode,
    ApiGraph,
    GraphDef,
    ApiNodeList,
} from "../../src";
import { edges, Transaction, Subcategory, MainCategory, ExpenseType, IncomeType, Schema, CustomGraph } from "../types";
import { baseEntities } from "../shared";
import { getApiGraph } from "./openapiClientGraph.test";

describe("API-Bound Graph Wrapper (Handlers)", () => {
    it("handles optimistic update and automatic transaction rollback on failure", async () => {
        let shouldFail = false;
        let handlerCalled = 0;

        const api = {
            transaction: {
                update: async (data: any) => {
                    handlerCalled++;
                    if (shouldFail) {
                        throw new Error("Network Error");
                    }
                    return data;
                },
            },
        } as const satisfies ValidApi<CustomGraph>;

        type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
        const apiGraph = createGraph<CustomApiGraphDef>({
            entities: structuredClone(baseEntities),
            edges,
            api,
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

        const api = {
            transaction: {
                delete: async (id: string) => {
                    handlerCalled++;
                    if (shouldFail) {
                        throw new Error("Network Error");
                    }
                },
            },
        } as const satisfies ValidApi<CustomGraph>;

        type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
        const apiGraph = createGraph<CustomApiGraphDef>({
            entities: structuredClone(baseEntities),
            edges,
            api,
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
        const api = {
            transaction: {
                create: async (data: any) => {
                    handlerCalled++;
                    return { id: "tx_new", subcategoryId: data.subcategoryId };
                },
            },
        } as const satisfies ValidApi<CustomGraph>;

        type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
        const apiGraph = createGraph<CustomApiGraphDef>({
            entities: structuredClone(baseEntities),
            edges,
            api,
        });
        const node = await apiGraph.createTransaction({ subcategoryId: "sub1" });

        expect(node.value()?.id).toBe("tx_new");
        expect(node.value()?.subcategoryId).toBe("sub1");
        expect(apiGraph.transaction("tx_new").exists()).toBe(true);
        expect(handlerCalled).toBe(1);
    });

    it("supports root-level create helpers like createTransaction(data)", async () => {
        let createCalledWith: Partial<Transaction> | null = null;

        const api = {
            transaction: {
                create: async (data: any) => {
                    createCalledWith = data;
                    return { id: data.id ?? "tx1", ...data } as any;
                },
            },
        } as const satisfies ValidApi<CustomGraph>;

        type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
        const apiGraph = createGraph<CustomApiGraphDef>({
            entities: structuredClone(baseEntities),
            edges,
            api,
        });

        await apiGraph.createTransaction({
            id: "tx1",
            subcategoryId: "sub2",
            amount: 75,
        });

        expect(createCalledWith).toEqual({
            id: "tx1",
            subcategoryId: "sub2",
            amount: 75,
        });
        expect(apiGraph.transaction("tx1").value()?.subcategoryId).toBe("sub2");
    });

    it("supports lazy loading a missing node via load()", async () => {
        let handlerCalled = 0;
        const api = {
            transaction: {
                read: async (id: string) => {
                    handlerCalled++;
                    if (id === "tx_ghost") {
                        return { id: "tx_ghost", subcategoryId: "sub2" };
                    }
                    throw new Error("Not Found");
                },
            },
        } as const satisfies ValidApi<CustomGraph>;

        type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
        const apiGraph = createGraph<CustomApiGraphDef>({
            entities: structuredClone(baseEntities),
            edges,
            api,
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

        const api = {
            transaction: {
                list: async () => {
                    requestCount++;
                    return [
                        { id: "t1", subcategoryId: "sub1" },
                        { id: "t2", subcategoryId: "sub1" },
                    ] as Transaction[];
                },
            },
        } as const satisfies ValidApi<CustomGraph>;

        type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
        const apiGraph = createGraph<CustomApiGraphDef>({
            entities: {
                transaction: [] as Transaction[],
                subcategory: [] as Subcategory[],
                mainCategory: [] as MainCategory[],
                expenseType: [] as ExpenseType[],
                incomeType: [] as IncomeType[],
            },
            edges,
            api,
        });

        const newGraph = getApiGraph();

        const list1 = await apiGraph.transactionNodes().load();
        expect(list1.ids()).toEqual(["t1", "t2"]);
        expect(requestCount).toBe(1);

        const list1Cache = await apiGraph.transactionNodes().load();
        expect(list1Cache.ids()).toEqual(["t1", "t2"]);
        expect(requestCount).toBe(1);
    });

    it("passes list load params and calling node list to list handlers", async () => {
        let requestCount = 0;
        let receivedListIds: (string | number)[] = [];

        const api = {
            transaction: {
                list: async (params: { subcategoryId: string }, list?: ApiNodeList<CustomGraph, Transaction>) => {
                    requestCount++;
                    receivedListIds = list?.ids() ?? [];
                    return [
                        { id: `t_${params.subcategoryId}_1`, subcategoryId: params.subcategoryId },
                        { id: `t_${params.subcategoryId}_2`, subcategoryId: params.subcategoryId },
                    ] as Transaction[];
                },
            },
        } as const satisfies ValidApi<CustomGraph>;

        type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
        const apiGraph = createGraph<CustomApiGraphDef>({
            entities: {
                transaction: [] as Transaction[],
                subcategory: [] as Subcategory[],
                mainCategory: [] as MainCategory[],
                expenseType: [] as ExpenseType[],
                incomeType: [] as IncomeType[],
            },
            edges,
            api,
        });

        const filtered = await apiGraph.transactionNodes().load({ subcategoryId: "sub1" });
        expect(filtered.ids()).toEqual(["t_sub1_1", "t_sub1_2"]);
        expect(receivedListIds).toEqual([]);

        const cached = await apiGraph.transactionNodes().load({ subcategoryId: "sub1" });
        expect(cached.ids()).toEqual(["t_sub1_1", "t_sub1_2"]);
        expect(requestCount).toBe(1);

        const other = await apiGraph.transactionNodes().load({ subcategoryId: "sub2" });
        expect(other.ids()).toEqual(["t_sub2_1", "t_sub2_2"]);
        expect(requestCount).toBe(2);
    });

    it("passes optional entity nodes to standard entity handlers", async () => {
        const handlerNodes: Record<string, { exists?: boolean; value?: Transaction }> = {};

        const api = {
            transaction: {
                create: async (
                    data: Omit<Transaction, "id"> & { id: string },
                    node?: ApiNode<CustomGraph, Transaction>,
                ) => {
                    handlerNodes.create = { exists: node?.exists(), value: node?.value() };
                    return { id: data.id, subcategoryId: data.subcategoryId } as Transaction;
                },
                read: async (id: string, node?: ApiNode<CustomGraph, Transaction>) => {
                    handlerNodes.read = { exists: node?.exists(), value: node?.value() };
                    return { id, subcategoryId: "sub2" } as Transaction;
                },
                update: async (data: Transaction, node?: ApiNode<CustomGraph, Transaction>) => {
                    handlerNodes.update = { exists: node?.exists(), value: node?.value() };
                    return data;
                },
                delete: async (id: string, node?: ApiNode<CustomGraph, Transaction>) => {
                    handlerNodes.delete = { exists: node?.exists(), value: node?.value() };
                },
            },
        } as const satisfies ValidApi<CustomGraph>;

        type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
        const apiGraph = createGraph<CustomApiGraphDef>({
            entities: structuredClone(baseEntities),
            edges,
            api,
        });

        await apiGraph.createTransaction({ id: "tx_node", subcategoryId: "sub1" });
        await apiGraph.transaction("tx1").load();
        await apiGraph.transaction("tx1").update((tx) => ({ ...tx, amount: 123 }));
        await apiGraph.transaction("tx2").delete();

        expect(handlerNodes.create.exists).toBe(false);
        expect(handlerNodes.read.exists).toBe(true);
        expect(handlerNodes.read.value?.id).toBe("tx1");
        expect(handlerNodes.update.exists).toBe(true);
        expect(handlerNodes.update.value?.amount).toBe(123);
        expect(handlerNodes.delete.exists).toBe(true);
        expect(handlerNodes.delete.value?.id).toBe("tx2");
    });

    it("respects custom node actions", async () => {
        const api = {
            transaction: {
                actions: {
                    vmi: async (node: ApiNode<CustomGraph, Transaction>, vmi: string) => {},
                    archive: async (node: ApiNode<CustomGraph, Transaction>) => {
                        await node.update((tx) => ({ ...tx, archived: true }));
                        return { ok: true };
                    },
                },
            },
        } as const satisfies ValidApi<CustomGraph>;

        type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
        const apiGraph = createGraph<CustomApiGraphDef>({
            entities: structuredClone(baseEntities),
            edges,
            api,
        });

        const node = apiGraph.transaction("tx1");
        const res = await node.api.archive();
        await node.api.vmi("");

        expect(res).toEqual({ ok: true });
        expect(node.value()?.archived).toBe(true);
    });

    it("respects root-level graph actions", async () => {
        const api = {
            actions: {
                batchImport: async (graph: ApiGraph<CustomGraph>, data: Transaction[]) => {
                    graph.meta.sync({ transaction: data }, { mode: "merge" });
                    return { imported: data.length };
                },
            },
        } as const satisfies ValidApi<CustomGraph>;

        type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
        const apiGraph = createGraph<CustomApiGraphDef>({
            entities: structuredClone(baseEntities),
            edges,
            api,
        });

        const res = await apiGraph.meta.api.batchImport([
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
                create: async (data: Omit<Transaction, "id"> & { id?: string }) => {
                    return { id: "tx_external", subcategoryId: data.subcategoryId } as Transaction;
                },
            },
            actions: {
                customGraphAction: async (graph: ApiGraph<MyGraphDef>, value: string) => {
                    return `external-${value}`;
                },
            },
        } as const satisfies ValidApi<MyGraphDef>;

        type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof apiOptions>;
        const apiGraph = createGraph<CustomApiGraphDef>({
            entities: structuredClone(baseEntities),
            edges,
            api: apiOptions,
        });

        const node = await apiGraph.createTransaction({ subcategoryId: "sub1" });
        expect(node.value()?.id).toBe("tx_external");

        const actionResult = await apiGraph.meta.api.customGraphAction("test");
        expect(actionResult).toBe("external-test");
    });

    it("ensures id parameters and fetch return types are strictly typed in ValidApi", async () => {
        const api = {
            transaction: {
                read: async (id: string) => {
                    return { id, subcategoryId: "sub1" } as Transaction;
                },
                list: async () => {
                    return [{ id: "tx1", subcategoryId: "sub1" }] as Transaction[];
                },
                update: async (data: any) => {
                    return data as Transaction;
                },
                delete: async (id: string) => {},
            },
        } as const satisfies ValidApi<CustomGraph>;

        type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
        const apiGraph = createGraph<CustomApiGraphDef>({
            entities: structuredClone(baseEntities),
            edges,
            api,
        });

        await apiGraph.transaction("tx1").load();
        expect(apiGraph.transaction("tx1").value()?.id).toBe("tx1");
    });

    it("passes entity data to update handler", async () => {
        let updateCalledWith: { data: Partial<Transaction> } = { data: {} };

        const api = {
            transaction: {
                update: async (data: any) => {
                    updateCalledWith = { data };
                    return undefined;
                },
            },
        } as const satisfies ValidApi<CustomGraph>;

        type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
        const apiGraph = createGraph<CustomApiGraphDef>({
            entities: structuredClone(baseEntities),
            edges,
            api,
        });

        await apiGraph.transaction("tx1").update((tx) => ({ ...tx, amount: 99 }));
        expect(updateCalledWith).toEqual({
            data: { id: "tx1", subcategoryId: "sub1", amount: 99 },
        });
        expect(updateCalledWith.data.id).toBe("tx1");
    });

    it("includes pending deltas in full graph snapshot and restores them via restore()", async () => {
        const api = {
            transaction: {
                delete: async () => {
                    return { message: "Offline", isTransient: true } as ApiError;
                },
            },
        } as const satisfies ValidApi<CustomGraph>;

        type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
        const apiGraph = createGraph<CustomApiGraphDef>({
            entities: structuredClone(baseEntities),
            edges,
            api,
        });

        await apiGraph.transaction("tx1").delete();
        expect(apiGraph.meta.pendingChanges().length).toBe(1);

        const snap = apiGraph.meta.snapshot();
        expect(snap.entities).toBeDefined();
        expect(snap.pendingDeltas.length).toBe(1);
        expect(snap.pendingDeltas[0].op).toBe("delete");

        const apiFresh = {} as const satisfies ValidApi<CustomGraph>;

        type CustomFreshGraphDef = ApiGraphDef<Schema, typeof edges, typeof apiFresh>;
        const freshGraph = createGraph<CustomFreshGraphDef>({
            entities: { ...structuredClone(baseEntities), transaction: [] as Transaction[] },
            edges,
            api: apiFresh,
        });
        expect(freshGraph.meta.pendingChanges().length).toBe(0);

        freshGraph.meta.restore(snap);
        expect(freshGraph.meta.pendingChanges().length).toBe(1);
        expect(freshGraph.meta.pendingChanges()[0].op).toBe("delete");
    });

    describe("Multi-Entity API Transactions (tx.commit() and tx.rollback())", () => {
        it("stages multiple entity mutations in a transaction and pushes them on commit()", async () => {
            const updatedTransactions: Transaction[] = [];
            const updatedSubcategories: Subcategory[] = [];

            const api = {
                transaction: {
                    update: async (data: any) => {
                        updatedTransactions.push(data);
                    },
                },
                subcategory: {
                    update: async (data: any) => {
                        updatedSubcategories.push(data);
                    },
                },
            } as const satisfies ValidApi<CustomGraph>;

            type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
            const apiGraph = createGraph<CustomApiGraphDef>({
                entities: structuredClone(baseEntities),
                edges,
                api,
            });

            const tx = apiGraph.meta.beginTransaction();
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
            const api = {
                transaction: {
                    update: async () => {
                        apiCalled = true;
                    },
                },
            } as const satisfies ValidApi<CustomGraph>;

            type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
            const apiGraph = createGraph<CustomApiGraphDef>({
                entities: structuredClone(baseEntities),
                edges,
                api,
            });

            const tx = apiGraph.meta.beginTransaction();
            await tx.transaction("tx1").update((t) => ({ ...t, subcategoryId: "sub2" }));
            tx.rollback();

            expect(apiCalled).toBe(false);
            expect(apiGraph.transaction("tx1").value()?.subcategoryId).toBe("sub1");
        });

        it("rolls back local changes when commit() encounters a permanent server error", async () => {
            const api = {
                transaction: {
                    update: async () => {
                        return { message: "Validation error", status: 400, isTransient: false } as ApiError;
                    },
                },
            } as const satisfies ValidApi<CustomGraph>;

            type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
            const apiGraph = createGraph<CustomApiGraphDef>({
                entities: structuredClone(baseEntities),
                edges,
                api,
            });

            const tx = apiGraph.meta.beginTransaction();
            await tx.transaction("tx1").update((t) => ({ ...t, subcategoryId: "sub2" }));

            const res = await tx.commit();
            expect(res.success).toBe(false);
            expect(res.error?.status).toBe(400);

            expect(apiGraph.transaction("tx1").value()?.subcategoryId).toBe("sub1");
        });

        it("supports nested transactions — inner commit merges into outer transaction without HTTP calls", async () => {
            const updatedTransactions: Transaction[] = [];
            const api = {
                transaction: {
                    update: async (data: any) => {
                        updatedTransactions.push(data);
                    },
                },
            } as const satisfies ValidApi<CustomGraph>;

            type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
            const apiGraph = createGraph<CustomApiGraphDef>({
                entities: structuredClone(baseEntities),
                edges,
                api,
            });

            const txOuter = apiGraph.meta.beginTransaction();
            const txInner = txOuter.meta.beginTransaction();

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
            const api = {
                transaction: {
                    update: async (data: any) => {
                        callLog.push(data.subcategoryId);
                    },
                },
            } as const satisfies ValidApi<CustomGraph>;

            type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
            const apiGraph = createGraph<CustomApiGraphDef>({
                entities: structuredClone(baseEntities),
                edges,
                api,
            });

            const txA = apiGraph.meta.beginTransaction();
            const txB = apiGraph.meta.beginTransaction();

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
            const api = {
                transaction: {
                    update: async (data: any) => {
                        if (data.subcategoryId === "fail") {
                            return { message: "Permanent Error", status: 400, isTransient: false } as ApiError;
                        }
                        return data;
                    },
                },
            } as const satisfies ValidApi<CustomGraph>;

            type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
            const apiGraph = createGraph<CustomApiGraphDef>({
                entities: structuredClone(baseEntities),
                edges,
                api,
            });

            const unsubscribe = apiGraph.meta.subscribe((evt) => {
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
            const api = {
                transaction: {
                    delete: async () => {
                        flushCount++;
                        if (flushCount === 1) {
                            return { message: "Offline", isTransient: true } as ApiError;
                        }
                        return undefined;
                    },
                },
            } as const satisfies ValidApi<CustomGraph>;

            type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
            const apiGraph = createGraph<CustomApiGraphDef>({
                entities: structuredClone(baseEntities),
                edges,
                api,
            });

            await apiGraph.transaction("tx1").delete();
            expect(apiGraph.meta.pendingChanges().length).toBe(1);

            const stop = apiGraph.meta.startAutoFlush({ intervalMs: 30, onOnline: false });

            await new Promise((resolve) => setTimeout(resolve, 80));

            stop();
            expect(apiGraph.meta.pendingChanges().length).toBe(0);
            expect(flushCount).toBeGreaterThanOrEqual(2);
        });
    });

    describe("Temporary-to-Server ID Remapping", () => {
        it("remaps temp ID to server ID and resolves original ID lookups", async () => {
            const api = {
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
            } as const satisfies ValidApi<CustomGraph>;

            type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
            const apiGraph = createGraph<CustomApiGraphDef>({
                entities: structuredClone(baseEntities),
                edges,
                api,
            });

            const node = await apiGraph.createSubcategory({
                id: "temp_sub_1",
                name: "Temp Groceries",
                mainCategoryId: "mc1",
            });

            expect(node.value()?.id).toBe("real_sub_99");

            expect(apiGraph.meta.resolveId("temp_sub_1")).toBe("real_sub_99");
            expect(apiGraph.meta.getOriginalId("real_sub_99")).toBe("temp_sub_1");

            expect(apiGraph.subcategory("temp_sub_1").value()?.name).toBe("Groceries");
            expect(apiGraph.subcategory("real_sub_99").value()?.name).toBe("Groceries");
        });

        it("remaps foreign keys across graph entities and queued deltas during flushPending()", async () => {
            let isOffline = true;
            const api = {
                subcategory: {
                    create: async (data: Subcategory) => {
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
                    update: async (data: any) => {
                        if (isOffline) {
                            return { message: "Offline", isTransient: true } as ApiError;
                        }
                        return data;
                    },
                },
            } as const satisfies ValidApi<CustomGraph>;

            type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
            const apiGraph = createGraph<CustomApiGraphDef>({
                entities: structuredClone(baseEntities),
                edges,
                api,
            });

            await apiGraph.createSubcategory({
                id: "temp_sub_offline",
                name: "Offline Sub",
                mainCategoryId: "mc1",
            });

            await apiGraph.transaction("tx1").update((tx) => ({ ...tx, subcategoryId: "temp_sub_offline" }));

            expect(apiGraph.transaction("tx1").value()?.subcategoryId).toBe("temp_sub_offline");
            expect(apiGraph.meta.pendingChanges().length).toBe(2);

            isOffline = false;
            const res = await apiGraph.meta.flushPending();

            expect(res.synced.length).toBe(2);
            expect(apiGraph.meta.resolveId("temp_sub_offline")).toBe("real_sub_100");
            expect(apiGraph.transaction("tx1").value()?.subcategoryId).toBe("real_sub_100");
        });
    });

    describe("Custom New Entity ID Formatting", () => {
        it("uses default UUID when no custom format is set", async () => {
            const api = {
                subcategory: {
                    create: async () => ({ message: "Offline", isTransient: true }) as ApiError,
                },
            } as const satisfies ValidApi<CustomGraph>;

            type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
            const apiGraph = createGraph<CustomApiGraphDef>({
                entities: structuredClone(baseEntities),
                edges,
                api,
            });

            const node = await apiGraph.createSubcategory({
                name: "Offline Sub",
                mainCategoryId: "mc1",
            });

            const generatedId = node.value()?.id;
            expect(typeof generatedId).toBe("string");
            expect(generatedId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        });

        it("uses custom formatter configured via apiGraph.setIdFormat()", async () => {
            const api = {
                subcategory: {
                    create: async () => ({ message: "Offline", isTransient: true }) as ApiError,
                },
            } as const satisfies ValidApi<CustomGraph>;

            type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
            const apiGraph = createGraph<CustomApiGraphDef>({
                entities: structuredClone(baseEntities),
                edges,
                api,
            });

            apiGraph.meta.setIdFormat((entity: string, index: number) => `${entity}_custom_${index}`);

            const node1 = await apiGraph.createSubcategory({
                name: "Offline Sub 1",
                mainCategoryId: "mc1",
            });

            const node2 = await apiGraph.createSubcategory({
                name: "Offline Sub 2",
                mainCategoryId: "mc1",
            });

            expect(node1.value()?.id).toBe("subcategory_custom_1");
            expect(node2.value()?.id).toBe("subcategory_custom_2");
        });

        it("uses custom formatter configured via idFormat option", async () => {
            const api = {
                idFormat: (entity: string, index: number) => `${entity}_opt_${index}`,
                subcategory: {
                    create: async () => ({ message: "Offline", isTransient: true }) as ApiError,
                },
            } as const satisfies ValidApi<CustomGraph>;

            type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
            const apiGraph = createGraph<CustomApiGraphDef>({
                entities: structuredClone(baseEntities),
                edges,
                api,
            });

            const node = await apiGraph.createSubcategory({
                name: "Offline Sub",
                mainCategoryId: "mc1",
            });

            expect(node.value()?.id).toBe("subcategory_opt_1");
        });
    });

    describe("Transient Error Handling Options", () => {
        it("allows inspect err.raw in global isTransientError handler", async () => {
            let receivedRawResponse: any = null;
            const api = {
                isTransientError: (err: ApiError) => {
                    receivedRawResponse = err.raw;
                    return err.raw?.customHeader === "RETRY_LATER";
                },
                transaction: {
                    update: async (data: any) => {
                        return {
                            status: 400,
                            message: "Bad Request",
                            customHeader: "RETRY_LATER",
                        };
                    },
                },
            } as const satisfies ValidApi<CustomGraph>;

            type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
            const apiGraph = createGraph<CustomApiGraphDef>({
                entities: structuredClone(baseEntities),
                edges,
                api,
            });

            const err = await apiGraph.transaction("tx1").update((tx) => ({ ...tx, amount: 999 }));
            expect(receivedRawResponse).toEqual(expect.objectContaining({ customHeader: "RETRY_LATER" }));
            expect((err as ApiError).isTransient).toBe(true);
        });

        it("decides transience from err.raw custom status property", async () => {
            const api = {
                isTransientError: (err: ApiError) => err.raw?.customStatus === "TEMPORARY_FAILURE",
                transaction: {
                    update: async () => ({
                        customStatus: "TEMPORARY_FAILURE",
                        message: "Server Busy",
                    }),
                },
            } as const satisfies ValidApi<CustomGraph>;

            type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
            const apiGraph = createGraph<CustomApiGraphDef>({
                entities: structuredClone(baseEntities),
                edges,
                api,
            });

            const err = await apiGraph.transaction("tx1").update((tx) => ({ ...tx, amount: 999 }));
            expect((err as ApiError).isTransient).toBe(true);
            expect(apiGraph.meta.pendingChanges().length).toBe(1);
        });

        it("allows entity-level isTransientError to override global options", async () => {
            const api = {
                isTransientError: () => false, // global says non-transient
                transaction: {
                    isTransientError: (err: ApiError) => err.raw?.entityLevelTransient === true, // entity says transient!
                    update: async () => ({
                        message: "Failed",
                        entityLevelTransient: true,
                    }),
                },
            } as const satisfies ValidApi<CustomGraph>;

            type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
            const apiGraph = createGraph<CustomApiGraphDef>({
                entities: structuredClone(baseEntities),
                edges,
                api,
            });

            const err = await apiGraph.transaction("tx1").update((tx) => ({ ...tx, amount: 999 }));
            expect((err as ApiError).isTransient).toBe(true);
            expect(apiGraph.meta.pendingChanges().length).toBe(1);
        });

        it("converts status-only error responses into ApiError with default message", async () => {
            const api = {
                transaction: {
                    update: async () => ({ status: 503 }) as ApiError, // No explicit .message property
                },
            } as const satisfies ValidApi<CustomGraph>;

            type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
            const apiGraph = createGraph<CustomApiGraphDef>({
                entities: structuredClone(baseEntities),
                edges,
                api,
            });

            const err = await apiGraph.transaction("tx1").update((tx) => ({ ...tx, amount: 999 }));
            expect(err?.status).toBe(503);
            expect(err?.message).toContain("503");
            expect(err?.isTransient).toBe(true);
        });
    });

    describe("Custom Create Signature Matching", () => {
        it("mirrors the type signature of custom create handlers", async () => {
            let passedExtraArg: string | undefined;

            const api = {
                subcategory: {
                    create: async (payload: { data: { name: string; mainCategoryId: string }; extraArg: string }) => {
                        passedExtraArg = payload.extraArg;
                        return {
                            id: "sub_1",
                            name: payload.data.name,
                            mainCategoryId: payload.data.mainCategoryId,
                            expenseTypeId: "exp1",
                        } as Subcategory;
                    },
                },
            } as const satisfies ValidApi<CustomGraph>;

            type CustomApiGraphDef = ApiGraphDef<Schema, typeof edges, typeof api>;
            const apiGraph = createGraph<CustomApiGraphDef>({
                entities: structuredClone(baseEntities),
                edges,
                api,
            });

            const node = await apiGraph.createSubcategory({
                data: { name: "Electronics", mainCategoryId: "mc1" },
                extraArg: "super-secret-token",
            });

            expect(node.value()?.name).toBe("Electronics");
            expect(passedExtraArg).toBe("super-secret-token");
        });
    });
});
