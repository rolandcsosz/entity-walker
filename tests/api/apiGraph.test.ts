import { describe, it, expect } from "vitest";
import { createGraph, GraphDef, ValidApi } from "../../src";
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
                    }
                }
            }
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
                    }
                }
            }
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
                    }
                }
            }
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
                    }
                }
            }
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
                    }
                }
            }
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
                incomeType: [] as IncomeType[]
            },
            edges,
            api: {
                transaction: {
                    list: async () => {
                        requestCount++;
                        return [
                            { id: "t1", subcategoryId: "sub1" },
                            { id: "t2", subcategoryId: "sub1" }
                        ] as Transaction[];
                    }
                }
            }
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
                        }
                    }
                }
            }
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
                    }
                }
            }
        });

        const res = await apiGraph.api.batchImport([
            { id: "tx_batch_1", subcategoryId: "sub1" },
            { id: "tx_batch_2", subcategoryId: "sub2" }
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
                }
            },
            actions: {
                customGraphAction: async (graph, value: string) => {
                    return `external-${value}`;
                }
            }
        } satisfies ValidApi<MyGraphDef>;

        const apiGraph = createGraph({
            entities: structuredClone(baseEntities),
            edges,
            api: apiOptions
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
                delete: async (id: string) => {
                },
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
});
