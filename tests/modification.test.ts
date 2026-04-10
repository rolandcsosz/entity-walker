import { describe, it, expect } from "vitest";
import { Entities, createGraph } from "../src/index";
import { edges, Schema } from "./types";

const baseEntities: Entities<Schema> = {
    transaction: [
        { id: "tx1", subcategoryId: "sub1" },
        { id: "tx2", subcategoryId: "sub2" },
    ],
    subcategory: [
        { id: "sub1", name: "sub1", mainCategoryId: "cat1" },
        { id: "sub2", name: "sub2", mainCategoryId: "cat1" },
    ],
    mainCategory: [
        { id: "cat1", name: "Food", expenseTypeId: "et1", incomeTypeId: "it1" },
    ],
    expenseType: [{ id: "et1", description: "Groceries" }],
    incomeType: [{ id: "it1", description: "Salary" }],
};

function makeGraph() {
    return createGraph({ entities: structuredClone(baseEntities), edges });
}

describe("insert — single entity", () => {
    it("inserted entity is retrievable by id", () => {
        const graph = makeGraph();
        graph.
        insertSubcategory({ id: "sub3", name: "sub3", mainCategoryId: "cat1" });
        expect(graph.subcategory("sub3").value()?.name).toBe("sub3");
    });

    it("inserted entity appears in Nodes list", () => {
        const graph = makeGraph();
        graph.insertSubcategory({ id: "sub3", name: "sub3", mainCategoryId: "cat1" });
        const ids = graph.subcategoryNodes().ids();
        expect(ids).toContain("sub3");
        expect(ids).toHaveLength(3);
    });

    it("inserted entity is traversable via forward edge", () => {
        const graph = makeGraph();
        graph.insertTransaction({ id: "tx3", subcategoryId: "sub1" });
        const sub = graph.transaction("tx3").subcategory().value();
        expect(sub?.id).toBe("sub1");
    });

    it("inserted entity is reachable via reverse edge (bidirectional)", () => {
        const graph = makeGraph();
        graph.insertTransaction({ id: "tx3", subcategoryId: "sub1" });
        const txIds = graph.subcategory("sub1").transactionNodes().ids();
        expect(txIds).toContain("tx3");
    });

    it("does not affect unrelated entities", () => {
        const graph = makeGraph();
        graph.insertSubcategory({ id: "sub3", name: "sub3", mainCategoryId: "cat1" });
        expect(graph.transactionNodes().ids()).toEqual(["tx1", "tx2"]);
    });

    it("overwrites stale cache when inserting an entity with a previously queried id", () => {
        const graph = makeGraph();
        // pre-cache a miss
        expect(graph.subcategory("sub99").exists()).toBe(false);
        graph.insertSubcategory({ id: "sub99", name: "new", mainCategoryId: "cat1" });
        expect(graph.subcategory("sub99").exists()).toBe(true);
        expect(graph.subcategory("sub99").value()?.name).toBe("new");
    });
});

describe("insert — array of entities", () => {
    it("all inserted entities are retrievable", () => {
        const graph = makeGraph();
        graph.insertSubcategory([
            { id: "sub3", name: "sub3", mainCategoryId: "cat1" },
            { id: "sub4", name: "sub4", mainCategoryId: "cat1" },
        ]);
        expect(graph.subcategory("sub3").exists()).toBe(true);
        expect(graph.subcategory("sub4").exists()).toBe(true);
    });

    it("Nodes list grows by the correct count", () => {
        const graph = makeGraph();
        graph.insertSubcategory([
            { id: "sub3", name: "sub3", mainCategoryId: "cat1" },
            { id: "sub4", name: "sub4", mainCategoryId: "cat1" },
        ]);
        expect(graph.subcategoryNodes().ids()).toHaveLength(4);
    });

    it("all inserted entities appear in reverse edge results", () => {
        const graph = makeGraph();
        graph.insertTransaction([
            { id: "tx3", subcategoryId: "sub1" },
            { id: "tx4", subcategoryId: "sub1" },
        ]);
        const txIds = graph.subcategory("sub1").transactionNodes().ids();
        expect(txIds).toContain("tx3");
        expect(txIds).toContain("tx4");
    });
});

describe("insert — Nodes filtering after insert", () => {
    it("where predicate works on inserted entities", () => {
        const graph = makeGraph();
        graph.insertSubcategory({ id: "sub3", name: "special", mainCategoryId: "cat1" });
        const found = graph.subcategoryNodes(s => s.name === "special").ids();
        expect(found).toEqual(["sub3"]);
    });

    it("inserted entity with non-existing FK resolves to null node", () => {
        const graph = makeGraph();
        graph.insertTransaction({ id: "tx3", subcategoryId: "ghost" });
        expect(graph.transaction("tx3").subcategory().exists()).toBe(false);
    });
});

describe("update — replace existing", () => {
    it("updated entity value is reflected", () => {
        const graph = makeGraph();
        graph.updateSubcategory({ id: "sub1", name: "renamed", mainCategoryId: "cat1" });
        expect(graph.subcategory("sub1").value()?.name).toBe("renamed");
    });

    it("Nodes list count stays the same after update", () => {
        const graph = makeGraph();
        graph.updateSubcategory({ id: "sub1", name: "renamed", mainCategoryId: "cat1" });
        expect(graph.subcategoryNodes().ids()).toHaveLength(2);
    });

    it("clears node cache so value() returns fresh data", () => {
        const graph = makeGraph();
        graph.subcategory("sub1").value(); // prime cache
        graph.updateSubcategory({ id: "sub1", name: "updated", mainCategoryId: "cat1" });
        expect(graph.subcategory("sub1").value()?.name).toBe("updated");
    });

    it("updates reverse index when FK changes", () => {
        const graph = makeGraph();
        // tx1 points to sub1 — move it to sub2
        graph.updateTransaction({ id: "tx1", subcategoryId: "sub2" });
        expect(graph.subcategory("sub1").transactionNodes().ids()).not.toContain("tx1");
        expect(graph.subcategory("sub2").transactionNodes().ids()).toContain("tx1");
    });

    it("array update replaces all provided entities", () => {
        const graph = makeGraph();
        graph.updateSubcategory([
            { id: "sub1", name: "a", mainCategoryId: "cat1" },
            { id: "sub2", name: "b", mainCategoryId: "cat1" },
        ]);
        expect(graph.subcategory("sub1").value()?.name).toBe("a");
        expect(graph.subcategory("sub2").value()?.name).toBe("b");
    });
});

describe("update — upsert (not present → insert)", () => {
    it("inserts entity when id does not exist", () => {
        const graph = makeGraph();
        graph.updateSubcategory({ id: "sub99", name: "new", mainCategoryId: "cat1" });
        expect(graph.subcategory("sub99").exists()).toBe(true);
        expect(graph.subcategory("sub99").value()?.name).toBe("new");
    });

    it("Nodes list grows when upserting a new entity", () => {
        const graph = makeGraph();
        graph.updateSubcategory({ id: "sub99", name: "new", mainCategoryId: "cat1" });
        expect(graph.subcategoryNodes().ids()).toHaveLength(3);
    });
});

describe("delete — node.delete()", () => {
    it("entity no longer exists after delete", () => {
        const graph = makeGraph();
        graph.subcategory("sub1").delete();
        expect(graph.subcategory("sub1").exists()).toBe(false);
    });

    it("deleted entity is removed from Nodes list", () => {
        const graph = makeGraph();
        graph.subcategory("sub1").delete();
        expect(graph.subcategoryNodes().ids()).not.toContain("sub1");
        expect(graph.subcategoryNodes().ids()).toHaveLength(1);
    });

    it("deleted entity is removed from reverse index", () => {
        const graph = makeGraph();
        graph.transaction("tx1").delete();
        expect(graph.subcategory("sub1").transactionNodes().ids()).not.toContain("tx1");
    });

    it("deleting a null node is a no-op", () => {
        const graph = makeGraph();
        expect(() => graph.subcategory("ghost").delete()).not.toThrow();
    });

    it("forward edge to deleted entity resolves to null node", () => {
        const graph = makeGraph();
        graph.subcategory("sub1").delete();
        expect(graph.transaction("tx1").subcategory().exists()).toBe(false);
    });
});

describe("deleteCascade — node.deleteCascade()", () => {
    it("deletes the entity itself", () => {
        const graph = makeGraph();
        graph.subcategory("sub1").deleteCascade();
        expect(graph.subcategory("sub1").exists()).toBe(false);
    });

    it("cascades to entities pointing to it", () => {
        const graph = makeGraph();
        // sub1 is referenced by tx1 and tx3 (tx3 doesn't exist here, just tx1)
        graph.subcategory("sub1").deleteCascade();
        expect(graph.transaction("tx1").exists()).toBe(false);
    });

    it("does not delete entities pointing to a different target", () => {
        const graph = makeGraph();
        graph.subcategory("sub1").deleteCascade();
        expect(graph.transaction("tx2").exists()).toBe(true);
    });

    it("cascades recursively (mainCategory → subcategory → transaction)", () => {
        const graph = makeGraph();
        graph.mainCategory("cat1").deleteCascade();
        expect(graph.subcategory("sub1").exists()).toBe(false);
        expect(graph.subcategory("sub2").exists()).toBe(false);
        expect(graph.transaction("tx1").exists()).toBe(false);
        expect(graph.transaction("tx2").exists()).toBe(false);
    });

    it("cascaded deletions are removed from Nodes lists", () => {
        const graph = makeGraph();
        graph.subcategory("sub1").deleteCascade();
        expect(graph.transactionNodes().ids()).not.toContain("tx1");
        expect(graph.transactionNodes().ids()).toHaveLength(1);
    });

    it("is a no-op on a non-existing entity", () => {
        const graph = makeGraph();
        expect(() => (graph.subcategory("ghost") as any).deleteCascade()).not.toThrow();
    });
});
