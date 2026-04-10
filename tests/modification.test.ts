import { describe, it, expect } from "vitest";
import { GraphWrapper, makeNonProxy, makeProxy } from "./shared";

function runModificationTests(label: string, make: () => GraphWrapper) {

    describe(`${label} — insert — single entity`, () => {
        it("inserted entity is retrievable by id", () => {
            const { rootNode, insert } = make();
            insert("subcategory", { id: "sub3", name: "sub3", mainCategoryId: "cat1" });
            expect(rootNode("subcategory", "sub3").value()?.name).toBe("sub3");
        });

        it("inserted entity appears in Nodes list", () => {
            const { nodeList, insert } = make();
            insert("subcategory", { id: "sub3", name: "sub3", mainCategoryId: "cat1" });
            const ids = nodeList("subcategory").ids();
            expect(ids).toContain("sub3");
            expect(ids).toHaveLength(3);
        });

        it("inserted entity is traversable via forward edge", () => {
            const { rootNode, path, insert } = make();
            insert("transaction", { id: "tx3", subcategoryId: "sub1" });
            const sub = path(rootNode("transaction", "tx3"), "subcategory").value();
            expect(sub?.id).toBe("sub1");
        });

        it("inserted entity is reachable via reverse edge (bidirectional)", () => {
            const { rootNode, path, insert } = make();
            insert("transaction", { id: "tx3", subcategoryId: "sub1" });
            const txIds = path(rootNode("subcategory", "sub1"), "transactionNodes").ids();
            expect(txIds).toContain("tx3");
        });

        it("does not affect unrelated entities", () => {
            const { nodeList, insert } = make();
            insert("subcategory", { id: "sub3", name: "sub3", mainCategoryId: "cat1" });
            expect(nodeList("transaction").ids()).toEqual(["tx1", "tx2", "tx3"]);
        });

        it("overwrites stale cache when inserting an entity with a previously queried id", () => {
            const { rootNode, insert } = make();
            expect(rootNode("subcategory", "sub99").exists()).toBe(false);
            insert("subcategory", { id: "sub99", name: "new", mainCategoryId: "cat1" });
            expect(rootNode("subcategory", "sub99").exists()).toBe(true);
            expect(rootNode("subcategory", "sub99").value()?.name).toBe("new");
        });
    });

    describe(`${label} — insert — array of entities`, () => {
        it("all inserted entities are retrievable", () => {
            const { rootNode, insert } = make();
            insert("subcategory", [
                { id: "sub3", name: "sub3", mainCategoryId: "cat1" },
                { id: "sub4", name: "sub4", mainCategoryId: "cat1" },
            ]);
            expect(rootNode("subcategory", "sub3").exists()).toBe(true);
            expect(rootNode("subcategory", "sub4").exists()).toBe(true);
        });

        it("Nodes list grows by the correct count", () => {
            const { nodeList, insert } = make();
            insert("subcategory", [
                { id: "sub3", name: "sub3", mainCategoryId: "cat1" },
                { id: "sub4", name: "sub4", mainCategoryId: "cat1" },
            ]);
            expect(nodeList("subcategory").ids()).toHaveLength(4);
        });

        it("all inserted entities appear in reverse edge results", () => {
            const { rootNode, path, insert } = make();
            insert("transaction", [
                { id: "tx3", subcategoryId: "sub1" },
                { id: "tx4", subcategoryId: "sub1" },
            ]);
            const txIds = path(rootNode("subcategory", "sub1"), "transactionNodes").ids();
            expect(txIds).toContain("tx3");
            expect(txIds).toContain("tx4");
        });
    });

    describe(`${label} — insert — Nodes filtering after insert`, () => {
        it("where predicate works on inserted entities", () => {
            const { nodeList, insert } = make();
            insert("subcategory", { id: "sub3", name: "special", mainCategoryId: "cat1" });
            const found = nodeList("subcategory", (s: any) => s.name === "special").ids();
            expect(found).toEqual(["sub3"]);
        });

        it("inserted entity with non-existing FK resolves to null node", () => {
            const { rootNode, path, insert } = make();
            insert("transaction", { id: "tx3", subcategoryId: "ghost" });
            expect(path(rootNode("transaction", "tx3"), "subcategory").exists()).toBe(false);
        });
    });

    describe(`${label} — update — replace existing`, () => {
        it("updated entity value is reflected", () => {
            const { rootNode, update } = make();
            update("subcategory", { id: "sub1", name: "renamed", mainCategoryId: "cat1" });
            expect(rootNode("subcategory", "sub1").value()?.name).toBe("renamed");
        });

        it("Nodes list count stays the same after update", () => {
            const { nodeList, update } = make();
            update("subcategory", { id: "sub1", name: "renamed", mainCategoryId: "cat1" });
            expect(nodeList("subcategory").ids()).toHaveLength(2);
        });

        it("clears node cache so value() returns fresh data", () => {
            const { rootNode, update } = make();
            rootNode("subcategory", "sub1").value();
            update("subcategory", { id: "sub1", name: "updated", mainCategoryId: "cat1" });
            expect(rootNode("subcategory", "sub1").value()?.name).toBe("updated");
        });

        it("updates reverse index when FK changes", () => {
            const { rootNode, path, update } = make();
            update("transaction", { id: "tx1", subcategoryId: "sub2" });
            expect(path(rootNode("subcategory", "sub1"), "transactionNodes").ids()).not.toContain("tx1");
            expect(path(rootNode("subcategory", "sub2"), "transactionNodes").ids()).toContain("tx1");
        });

        it("array update replaces all provided entities", () => {
            const { rootNode, update } = make();
            update("subcategory", [
                { id: "sub1", name: "a", mainCategoryId: "cat1" },
                { id: "sub2", name: "b", mainCategoryId: "cat1" },
            ]);
            expect(rootNode("subcategory", "sub1").value()?.name).toBe("a");
            expect(rootNode("subcategory", "sub2").value()?.name).toBe("b");
        });
    });

    describe(`${label} — update — upsert (not present → insert)`, () => {
        it("inserts entity when id does not exist", () => {
            const { rootNode, update } = make();
            update("subcategory", { id: "sub99", name: "new", mainCategoryId: "cat1" });
            expect(rootNode("subcategory", "sub99").exists()).toBe(true);
            expect(rootNode("subcategory", "sub99").value()?.name).toBe("new");
        });

        it("Nodes list grows when upserting a new entity", () => {
            const { nodeList, update } = make();
            update("subcategory", { id: "sub99", name: "new", mainCategoryId: "cat1" });
            expect(nodeList("subcategory").ids()).toHaveLength(3);
        });
    });

    describe(`${label} — delete — node.delete()`, () => {
        it("entity no longer exists after delete", () => {
            const { rootNode } = make();
            rootNode("subcategory", "sub1").delete();
            expect(rootNode("subcategory", "sub1").exists()).toBe(false);
        });

        it("deleted entity is removed from Nodes list", () => {
            const { rootNode, nodeList } = make();
            rootNode("subcategory", "sub1").delete();
            expect(nodeList("subcategory").ids()).not.toContain("sub1");
            expect(nodeList("subcategory").ids()).toHaveLength(1);
        });

        it("deleted entity is removed from reverse index", () => {
            const { rootNode, path } = make();
            rootNode("transaction", "tx1").delete();
            expect(path(rootNode("subcategory", "sub1"), "transactionNodes").ids()).not.toContain("tx1");
        });

        it("deleting a null node is a no-op", () => {
            const { rootNode } = make();
            expect(() => rootNode("subcategory", "ghost").delete()).not.toThrow();
        });

        it("forward edge to deleted entity resolves to null node", () => {
            const { rootNode, path } = make();
            rootNode("subcategory", "sub1").delete();
            expect(path(rootNode("transaction", "tx1"), "subcategory").exists()).toBe(false);
        });
    });

    describe(`${label} — deleteCascade — node.deleteCascade()`, () => {
        it("deletes the entity itself", () => {
            const { rootNode } = make();
            rootNode("subcategory", "sub1").deleteCascade();
            expect(rootNode("subcategory", "sub1").exists()).toBe(false);
        });

        it("cascades to entities pointing to it", () => {
            const { rootNode } = make();
            rootNode("subcategory", "sub1").deleteCascade();
            expect(rootNode("transaction", "tx1").exists()).toBe(false);
        });

        it("does not delete entities pointing to a different target", () => {
            const { rootNode } = make();
            rootNode("subcategory", "sub1").deleteCascade();
            expect(rootNode("transaction", "tx2").exists()).toBe(true);
        });

        it("cascades recursively (mainCategory -> subcategory -> transaction)", () => {
            const { rootNode } = make();
            rootNode("mainCategory", "cat1").deleteCascade();
            expect(rootNode("subcategory", "sub1").exists()).toBe(false);
            expect(rootNode("subcategory", "sub2").exists()).toBe(false);
            expect(rootNode("transaction", "tx1").exists()).toBe(false);
            expect(rootNode("transaction", "tx2").exists()).toBe(false);
        });

        it("cascaded deletions are removed from Nodes lists", () => {
            const { rootNode, nodeList } = make();
            rootNode("subcategory", "sub1").deleteCascade();
            expect(nodeList("transaction").ids()).not.toContain("tx1");
            expect(nodeList("transaction").ids()).toHaveLength(1);
        });

        it("is a no-op on a non-existing entity", () => {
            const { rootNode } = make();
            expect(() => rootNode("subcategory", "ghost").deleteCascade()).not.toThrow();
        });
    });
}

runModificationTests("Proxy", makeProxy);
runModificationTests("NonProxy", makeNonProxy);
