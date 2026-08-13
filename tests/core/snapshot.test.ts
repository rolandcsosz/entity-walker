import { describe, it, expect } from "vitest";
import { EntityGraph, EntityGraphNoProxy, GraphDef, createGraph, createNonProxyGraph } from "../../src";
import { CustomGraph, SchemaNumeric, edges, numericEdges } from "../types";
import { baseEntities, baseEntitiesNumeric } from "../shared";

type CustomGraphNumeric = GraphDef<SchemaNumeric, typeof numericEdges>;

function proxyGraph(): EntityGraph<CustomGraph> {
    return createGraph({ entities: structuredClone(baseEntities), edges });
}

function nonProxyGraph(): EntityGraphNoProxy<CustomGraph> {
    return createNonProxyGraph({ entities: structuredClone(baseEntities), edges });
}

function numericProxyGraph(): EntityGraph<CustomGraphNumeric> {
    return createGraph({ entities: structuredClone(baseEntitiesNumeric), edges: numericEdges });
}

describe("EntityGraph (proxy) — snapshot/restore", () => {
    describe("snapshot()", () => {
        it("returns an object with all entity type keys", () => {
            const g: EntityGraph<CustomGraph> = proxyGraph();
            const snap = g.meta.snapshot();
            expect(Object.keys(snap).sort()).toEqual([
                "expenseType",
                "incomeType",
                "mainCategory",
                "subcategory",
                "transaction",
            ]);
        });

        it("snapshot arrays match the original entity arrays", () => {
            const g: EntityGraph<CustomGraph> = proxyGraph();
            const snap = g.meta.snapshot();
            expect(snap.transaction).toEqual(baseEntities.transaction);
            expect(snap.subcategory).toEqual(baseEntities.subcategory);
            expect(snap.mainCategory).toEqual(baseEntities.mainCategory);
        });

        it("snapshot is a deep copy — mutating the snapshot does not change the graph", () => {
            const g: EntityGraph<CustomGraph> = proxyGraph();
            const snap = g.meta.snapshot();
            snap.transaction[0].subcategoryId = "MUTATED";
            expect(g.transaction("tx1").value()?.subcategoryId).toBe("sub1");
        });

        it("snapshot reflects mutations made after creation", () => {
            const g: EntityGraph<CustomGraph> = proxyGraph();
            g.createTransaction({ id: "tx1", subcategoryId: "sub2" });
            const snap = g.meta.snapshot();
            const tx1 = snap.transaction.find((t) => t.id === "tx1");
            expect(tx1?.subcategoryId).toBe("sub2");
        });

        it("snapshot can be JSON-serialised and deserialised without data loss", () => {
            const g: EntityGraph<CustomGraph> = proxyGraph();
            const snap = g.meta.snapshot();
            const roundtripped = JSON.parse(JSON.stringify(snap));
            expect(roundtripped).toEqual(snap);
        });
    });

    describe("restore()", () => {
        it("restores entities from snapshot — entities() returns snapshot data", () => {
            const g: EntityGraph<CustomGraph> = proxyGraph();
            const snap = g.meta.snapshot();
            g.createTransaction({ id: "tx1", subcategoryId: "sub2" });
            g.meta.restore(snap);

            const tx1 = g.transaction("tx1").value();
            expect(tx1?.subcategoryId).toBe("sub1");
        });

        it("restore rebuilds byId index — new lookups work", () => {
            const g: EntityGraph<CustomGraph> = proxyGraph();
            const snap = g.meta.snapshot();
            g.transaction("tx1").delete();
            g.meta.restore(snap);

            const tx1 = g.transaction("tx1").value();
            expect(tx1).toBeDefined();
            expect(tx1?.id).toBe("tx1");
        });

        it("restore rebuilds reverse index — bidirectional traversal works", () => {
            const g: EntityGraph<CustomGraph> = proxyGraph();
            const snap = g.meta.snapshot();
            g.createTransaction({ id: "tx1", subcategoryId: "sub2" });
            g.meta.restore(snap);

            const sub1Node = g.subcategory("sub1");
            const txIds = sub1Node.transactionNodes().ids();
            expect(txIds).toContain("tx1");
            expect(txIds).toContain("tx3");
        });

        it("restore with a different snapshot replaces all data", () => {
            const g: EntityGraph<CustomGraph> = proxyGraph();

            const altEntities: typeof baseEntities = {
                ...structuredClone(baseEntities),
                transaction: [{ id: "tx99", subcategoryId: "sub1" }],
            };
            const altSnap = createGraph({ entities: altEntities, edges }).meta.snapshot();

            g.meta.restore(altSnap);

            const txNodes = g.transactionNodes();
            expect(txNodes.ids()).toEqual(["tx99"]);
            expect(g.transaction("tx1").value()).toBeUndefined();
        });

        it("restore is a deep copy — mutating original snapshot afterwards does not affect graph", () => {
            const g: EntityGraph<CustomGraph> = proxyGraph();
            const snap = g.meta.snapshot();
            g.meta.restore(snap);
            snap.transaction[0].subcategoryId = "MUTATED_AFTER_RESTORE";

            const tx1 = g.transaction("tx1").value();
            expect(tx1?.subcategoryId).toBe("sub1");
        });

        it("node cache is cleared after restore — stale nodes are not returned", () => {
            const g: EntityGraph<CustomGraph> = proxyGraph();
            const beforeRestore = g.transaction("tx1").value();
            expect(beforeRestore?.subcategoryId).toBe("sub1");
            const snap = g.meta.snapshot();
            g.createTransaction({ id: "tx1", subcategoryId: "sub2" });
            g.meta.restore(snap);
            const afterRestore = g.transaction("tx1").value();
            expect(afterRestore?.subcategoryId).toBe("sub1");
        });

        it("entities added after restore are correct", () => {
            const g: EntityGraph<CustomGraph> = proxyGraph();
            const snap = g.meta.snapshot();
            g.meta.restore(snap);

            g.createTransaction({ id: "tx99", subcategoryId: "sub1" });
            const tx99 = g.transaction("tx99").value();
            expect(tx99?.id).toBe("tx99");
        });

        it("Nodes list after restore has the correct count", () => {
            const g: EntityGraph<CustomGraph> = proxyGraph();
            const snap = g.meta.snapshot();
            g.createTransaction({ id: "tx99", subcategoryId: "sub1" });
            g.meta.restore(snap);

            const ids = g.transactionNodes().ids();
            expect(ids).toHaveLength(3);
        });
    });

    describe("snapshot → JSON → restore round-trip", () => {
        it("all entity data survives JSON serialisation", () => {
            const g: EntityGraph<CustomGraph> = proxyGraph();
            const json = JSON.stringify(g.meta.snapshot());
            const g2: EntityGraph<CustomGraph> = proxyGraph();
            g2.meta.restore(JSON.parse(json));

            expect(g2.transactionNodes().entities().length).toEqual(g.transactionNodes().entities().length);
            expect(g2.subcategoryNodes().entities().length).toEqual(g.subcategoryNodes().entities().length);
            expect(g2.mainCategoryNodes().entities().length).toEqual(g.mainCategoryNodes().entities().length);
            expect(g2.expenseTypeNodes().entities().length).toEqual(g.expenseTypeNodes().entities().length);
            expect(g2.incomeTypeNodes().entities().length).toEqual(g.incomeTypeNodes().entities().length);
        });

        it("traversal works correctly after JSON round-trip", () => {
            const g: EntityGraph<CustomGraph> = proxyGraph();
            const g2: EntityGraph<CustomGraph> = proxyGraph();
            g2.meta.restore(JSON.parse(JSON.stringify(g.meta.snapshot())));

            const name = g2.transaction("tx1").subcategory().value()?.name;
            expect(name).toBe("sub1");
        });
    });
});

describe("EntityGraphNoProxy — snapshot/restore", () => {
    describe("snapshot()", () => {
        it("returns an object with all entity type keys", () => {
            const g: EntityGraphNoProxy<CustomGraph> = nonProxyGraph();
            const snap = g.meta.snapshot();
            expect(Object.keys(snap).sort()).toEqual([
                "expenseType",
                "incomeType",
                "mainCategory",
                "subcategory",
                "transaction",
            ]);
        });

        it("snapshot arrays match the original entity arrays", () => {
            const g: EntityGraphNoProxy<CustomGraph> = nonProxyGraph();
            const snap = g.meta.snapshot();
            expect(snap.transaction).toEqual(baseEntities.transaction);
            expect(snap.subcategory).toEqual(baseEntities.subcategory);
            expect(snap.mainCategory).toEqual(baseEntities.mainCategory);
        });

        it("snapshot is a deep copy — mutating the snapshot does not change the graph", () => {
            const g: EntityGraphNoProxy<CustomGraph> = nonProxyGraph();
            const snap = g.meta.snapshot();
            snap.transaction[0].subcategoryId = "MUTATED";
            expect(g.to("transaction", "tx1").value()?.subcategoryId).toBe("sub1");
        });

        it("snapshot reflects mutations made after creation", () => {
            const g: EntityGraphNoProxy<CustomGraph> = nonProxyGraph();
            g.create("transaction", { id: "tx1", subcategoryId: "sub2" });
            const snap = g.meta.snapshot();
            const tx1 = snap.transaction.find((t) => t.id === "tx1");
            expect(tx1?.subcategoryId).toBe("sub2");
        });

        it("snapshot can be JSON-serialised and deserialised without data loss", () => {
            const g: EntityGraphNoProxy<CustomGraph> = nonProxyGraph();
            const snap = g.meta.snapshot();
            const roundtripped = JSON.parse(JSON.stringify(snap));
            expect(roundtripped).toEqual(snap);
        });
    });

    describe("restore()", () => {
        it("restores entities from snapshot — entities() returns snapshot data", () => {
            const g: EntityGraphNoProxy<CustomGraph> = nonProxyGraph();
            const snap = g.meta.snapshot();
            g.create("transaction", { id: "tx1", subcategoryId: "sub2" });
            g.meta.restore(snap);

            const tx1 = g.to("transaction", "tx1").value();
            expect(tx1?.subcategoryId).toBe("sub1");
        });

        it("restore rebuilds byId index — new lookups work", () => {
            const g: EntityGraphNoProxy<CustomGraph> = nonProxyGraph();
            const snap = g.meta.snapshot();
            g.to("transaction", "tx1").delete();
            g.meta.restore(snap);

            const tx1 = g.to("transaction", "tx1").value();
            expect(tx1).toBeDefined();
            expect(tx1?.id).toBe("tx1");
        });

        it("restore rebuilds reverse index — bidirectional traversal works", () => {
            const g: EntityGraphNoProxy<CustomGraph> = nonProxyGraph();
            const snap = g.meta.snapshot();
            g.create("transaction", { id: "tx1", subcategoryId: "sub2" });
            g.meta.restore(snap);

            const sub1Node = g.to("subcategory", "sub1");
            const txIds = sub1Node.to("transactionNodes").ids();
            expect(txIds).toContain("tx1");
            expect(txIds).toContain("tx3");
        });

        it("restore with a different snapshot replaces all data", () => {
            const g: EntityGraphNoProxy<CustomGraph> = nonProxyGraph();

            const altEntities: typeof baseEntities = {
                ...structuredClone(baseEntities),
                transaction: [{ id: "tx99", subcategoryId: "sub1" }],
            };
            const altSnap = createGraph({ entities: altEntities, edges }).meta.snapshot();

            g.meta.restore(altSnap);

            const txNodes = g.to("transactionNodes");
            expect(txNodes.ids()).toEqual(["tx99"]);
            expect(g.to("transaction", "tx1").value()).toBeUndefined();
        });

        it("restore is a deep copy — mutating original snapshot afterwards does not affect graph", () => {
            const g: EntityGraphNoProxy<CustomGraph> = nonProxyGraph();
            const snap = g.meta.snapshot();
            g.meta.restore(snap);
            snap.transaction[0].subcategoryId = "MUTATED_AFTER_RESTORE";

            const tx1 = g.to("transaction", "tx1").value();
            expect(tx1?.subcategoryId).toBe("sub1");
        });

        it("node cache is cleared after restore — stale nodes are not returned", () => {
            const g: EntityGraphNoProxy<CustomGraph> = nonProxyGraph();
            const beforeRestore = g.to("transaction", "tx1").value();
            expect(beforeRestore?.subcategoryId).toBe("sub1");
            const snap = g.meta.snapshot();
            g.create("transaction", { id: "tx1", subcategoryId: "sub2" });
            g.meta.restore(snap);
            const afterRestore = g.to("transaction", "tx1").value();
            expect(afterRestore?.subcategoryId).toBe("sub1");
        });

        it("entities added after restore are correct", () => {
            const g: EntityGraphNoProxy<CustomGraph> = nonProxyGraph();
            const snap = g.meta.snapshot();
            g.meta.restore(snap);

            g.create("transaction", { id: "tx99", subcategoryId: "sub1" });
            const tx99 = g.to("transaction", "tx99").value();
            expect(tx99?.id).toBe("tx99");
        });

        it("Nodes list after restore has the correct count", () => {
            const g: EntityGraphNoProxy<CustomGraph> = nonProxyGraph();
            const snap = g.meta.snapshot();
            g.create("transaction", { id: "tx99", subcategoryId: "sub1" });
            g.meta.restore(snap);

            const ids = g.to("transactionNodes").ids();
            expect(ids).toHaveLength(3);
        });
    });

    describe("snapshot → JSON → restore round-trip", () => {
        it("all entity data survives JSON serialisation", () => {
            const g: EntityGraphNoProxy<CustomGraph> = nonProxyGraph();
            const json = JSON.stringify(g.meta.snapshot());
            const g2: EntityGraphNoProxy<CustomGraph> = nonProxyGraph();
            g2.meta.restore(JSON.parse(json));

            expect(g2.to("transactionNodes").entities().length).toEqual(g.to("transactionNodes").entities().length);
            expect(g2.to("subcategoryNodes").entities().length).toEqual(g.to("subcategoryNodes").entities().length);
            expect(g2.to("mainCategoryNodes").entities().length).toEqual(g.to("mainCategoryNodes").entities().length);
            expect(g2.to("expenseTypeNodes").entities().length).toEqual(g.to("expenseTypeNodes").entities().length);
            expect(g2.to("incomeTypeNodes").entities().length).toEqual(g.to("incomeTypeNodes").entities().length);
        });

        it("traversal works correctly after JSON round-trip", () => {
            const g: EntityGraphNoProxy<CustomGraph> = nonProxyGraph();
            const g2: EntityGraphNoProxy<CustomGraph> = nonProxyGraph();
            g2.meta.restore(JSON.parse(JSON.stringify(g.meta.snapshot())));

            const name = g2.to("transaction", "tx1").to("subcategory").value()?.name;
            expect(name).toBe("sub1");
        });
    });
});

describe("EntityGraph (proxy) numeric IDs — snapshot/restore", () => {
    it("snapshot preserves numeric ids", () => {
        const g: EntityGraph<CustomGraphNumeric> = numericProxyGraph();
        const snap = g.meta.snapshot();
        expect(typeof snap.transaction[0].id).toBe("number");
        expect(snap.transaction[0].id).toBe(1);
    });

    it("restore works with numeric ids", () => {
        const g: EntityGraph<CustomGraphNumeric> = numericProxyGraph();
        const snap = g.meta.snapshot();
        g.createTransaction({ id: 1, subcategoryId: 99 });
        g.meta.restore(snap);
        expect(g.transaction(1).value()?.subcategoryId).toBe(10);
    });
});
