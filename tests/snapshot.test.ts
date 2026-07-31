import { describe, it, expect } from "vitest";
import { createGraph, createNonProxyGraph } from "../src";
import { edges, numericEdges, SchemaNumeric } from "./types";
import { baseEntities, baseEntitiesNumeric, GraphWrapper, makeNonProxy, makeProxy } from "./shared";
import { Entities } from "../src/types";

function proxyGraph() {
    return createGraph({ entities: structuredClone(baseEntities), edges }) as any;
}

function nonProxyGraph() {
    return createNonProxyGraph({ entities: structuredClone(baseEntities), edges }) as any;
}

function numericProxyGraph() {
    return createGraph({ entities: structuredClone(baseEntitiesNumeric), edges: numericEdges }) as any;
}

function runSnapshotTests(label: string, make: () => any) {

    describe(label, () => {

        describe("snapshot()", () => {
            it("returns an object with all entity type keys", () => {
                const g = make();
                const snap = g.snapshot();
                expect(Object.keys(snap).sort()).toEqual(
                    ["expenseType", "incomeType", "mainCategory", "subcategory", "transaction"]
                );
            });

            it("snapshot arrays match the original entity arrays", () => {
                const g = make();
                const snap = g.snapshot();
                expect(snap.transaction).toEqual(baseEntities.transaction);
                expect(snap.subcategory).toEqual(baseEntities.subcategory);
                expect(snap.mainCategory).toEqual(baseEntities.mainCategory);
            });

            it("snapshot is a deep copy — mutating the snapshot does not change the graph", () => {
                const g = make();
                const snap = g.snapshot();
                snap.transaction[0].subcategoryId = "MUTATED";
                expect(g.transaction?.("tx1").value()?.subcategoryId ?? g.to?.("transaction", "tx1").value()?.subcategoryId)
                    .toBe("sub1");
            });

            it("snapshot reflects mutations made after creation", () => {
                const g = make();
                if (g.updateTransaction) g.updateTransaction({ id: "tx1", subcategoryId: "sub2" });
                else g.updateTransaction({ id: "tx1", subcategoryId: "sub2" });
                const snap = g.snapshot();
                const tx1 = snap.transaction.find((t: any) => t.id === "tx1");
                expect(tx1?.subcategoryId).toBe("sub2");
            });

            it("snapshot can be JSON-serialised and deserialised without data loss", () => {
                const g = make();
                const snap = g.snapshot();
                const roundtripped = JSON.parse(JSON.stringify(snap));
                expect(roundtripped).toEqual(snap);
            });
        });

        describe("restore()", () => {
            it("restores entities from snapshot — entities() returns snapshot data", () => {
                const g = make();
                const snap = g.snapshot();
                if (g.updateTransaction) g.updateTransaction({ id: "tx1", subcategoryId: "sub2" });
                else g.updateTransaction({ id: "tx1", subcategoryId: "sub2" });
                g.restore(snap);

                const tx1 = (g.transaction?.("tx1") ?? g.to("transaction", "tx1")).value();
                expect(tx1?.subcategoryId).toBe("sub1");
            });

            it("restore rebuilds byId index — new lookups work", () => {
                const g = make();
                const snap = g.snapshot();
                (g.transaction?.("tx1") ?? g.to("transaction", "tx1")).delete();
                g.restore(snap);

                const tx1 = (g.transaction?.("tx1") ?? g.to("transaction", "tx1")).value();
                expect(tx1).toBeDefined();
                expect(tx1?.id).toBe("tx1");
            });

            it("restore rebuilds reverse index — bidirectional traversal works", () => {
                const g = make();
                const snap = g.snapshot();
                if (g.updateTransaction) g.updateTransaction({ id: "tx1", subcategoryId: "sub2" });
                g.restore(snap);

                const sub1Node = g.subcategory?.("sub1") ?? g.to("subcategory", "sub1");
                const txIds: string[] = sub1Node.transactionNodes?.().ids() ?? sub1Node.to("transactionNodes").ids();
                expect(txIds).toContain("tx1");
                expect(txIds).toContain("tx3");
            });

            it("restore with a different snapshot replaces all data", () => {
                const g = make();

                const altEntities: Entities<typeof baseEntities> = {
                    ...structuredClone(baseEntities),
                    transaction: [{ id: "tx99", subcategoryId: "sub1" }],
                };
                const altSnap = createGraph({ entities: altEntities, edges }).snapshot();

                g.restore(altSnap as any);

                const txNodes = g.transactionNodes?.() ?? g.to("transactionNodes");
                expect(txNodes.ids()).toEqual(["tx99"]);
                expect((g.transaction?.("tx1") ?? g.to("transaction", "tx1")).value()).toBeUndefined();
            });

            it("restore is a deep copy — mutating original snapshot afterwards does not affect graph", () => {
                const g = make();
                const snap = g.snapshot();
                g.restore(snap);
                snap.transaction[0].subcategoryId = "MUTATED_AFTER_RESTORE";

                const tx1 = (g.transaction?.("tx1") ?? g.to("transaction", "tx1")).value();
                expect(tx1?.subcategoryId).toBe("sub1");
            });

            it("node cache is cleared after restore — stale nodes are not returned", () => {
                const g = make();
                const beforeRestore = (g.transaction?.("tx1") ?? g.to("transaction", "tx1")).value();
                expect(beforeRestore?.subcategoryId).toBe("sub1");
                const snap = g.snapshot();
                if (g.updateTransaction) g.updateTransaction({ id: "tx1", subcategoryId: "sub2" });
                g.restore(snap);
                const afterRestore = (g.transaction?.("tx1") ?? g.to("transaction", "tx1")).value();
                expect(afterRestore?.subcategoryId).toBe("sub1");
            });

            it("entities added after restore are correct", () => {
                const g = make();
                const snap = g.snapshot();
                g.restore(snap);

                if (g.updateTransaction) g.updateTransaction({ id: "tx99", subcategoryId: "sub1" });
                const tx99 = (g.transaction?.("tx99") ?? g.to("transaction", "tx99")).value();
                expect(tx99?.id).toBe("tx99");
            });

            it("Nodes list after restore has the correct count", () => {
                const g = make();
                const snap = g.snapshot();
                if (g.updateTransaction) g.updateTransaction({ id: "tx99", subcategoryId: "sub1" });
                g.restore(snap);

                const ids = (g.transactionNodes?.() ?? g.to("transactionNodes")).ids();
                expect(ids).toHaveLength(3);
            });
        });

        describe("snapshot → JSON → restore round-trip", () => {
            it("all entity data survives JSON serialisation", () => {
                const g = make();
                const json = JSON.stringify(g.snapshot());
                const g2 = make();
                g2.restore(JSON.parse(json));

                for (const type of ["transaction", "subcategory", "mainCategory", "expenseType", "incomeType"]) {
                    const nodesBefore = (g.transactionNodes?.() ?? g.to(`${type}Nodes`)).entities();
                    const nodesAfter  = (g2.transactionNodes?.() ?? g2.to(`${type}Nodes`)).entities();
                    expect(nodesAfter.length).toEqual(nodesBefore.length);
                }
            });

            it("traversal works correctly after JSON round-trip", () => {
                const g = make();
                const g2 = make();
                g2.restore(JSON.parse(JSON.stringify(g.snapshot())));

                const name = (g2.transaction?.("tx1") ?? g2.to("transaction", "tx1"))
                    .subcategory?.()?.value()?.name
                    ?? (g2.to("transaction", "tx1")).to("subcategory").value()?.name;
                expect(name).toBe("sub1");
            });
        });
    });
}

runSnapshotTests("EntityGraph (proxy)    — snapshot/restore", proxyGraph);
runSnapshotTests("EntityGraphNoProxy     — snapshot/restore", nonProxyGraph);

describe("EntityGraph (proxy) numeric IDs — snapshot/restore", () => {
    it("snapshot preserves numeric ids", () => {
        const g = numericProxyGraph();
        const snap = g.snapshot();
        expect(typeof snap.transaction[0].id).toBe("number");
        expect(snap.transaction[0].id).toBe(1);
    });

    it("restore works with numeric ids", () => {
        const g = numericProxyGraph();
        const snap = g.snapshot();
        g.updateTransaction({ id: 1, subcategoryId: 99 });
        g.restore(snap);
        expect(g.transaction(1).value()?.subcategoryId).toBe(10);
    });
});
