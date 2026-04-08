
import { describe, it, expect } from "vitest";
import { createEntityGraph } from "../src/graph";
import { Entities, EntityGraph } from "../src/types";
import { CustomGraph, edges, Schema } from "./types";


const entities: Entities<Schema> = {
    transaction: [
        { id: "tx1", subcategoryId: "sub1" },
        { id: "tx2", subcategoryId: "sub2" },
        { id: "tx3", subcategoryId: "sub1" },
    ],
    subcategory: [
        { id: "sub1", name: "sub1", mainCategoryId: "cat1" },
        { id: "sub2", name: "sub2", mainCategoryId: "cat1" },
    ],
    mainCategory: [
        { id: "cat1", name: "Food", expenseTypeId: "et1", incomeTypeId: "it1" },
        { id: "cat2", name: "Food", expenseTypeId: "error", incomeTypeId: "error" },
        { id: "cat3", name: "Food" },
    ],
    expenseType: [{ id: "et1", description: "Groceries" }],
    incomeType: [{ id: "it1", description: "Salary" }],
};

const graph: EntityGraph<CustomGraph> = createEntityGraph({
    entities,
    edges,
});

describe("entity graph", () => {

    it("access first node object", () => {
        const subcategoryId = graph
            .transaction("tx1").value()
            ?.subcategoryId;

        expect(subcategoryId).toBe("sub1");
    });

    it("access invalid first node object with valueOrThrow()", () => {
        expect(() => {
            graph.transaction("error").valueOrThrow();
        }).toThrow();
    });

    it("access invalid first node object with value()", () => {
        const transaction = graph.transaction("error").value();
        expect(transaction).toBeUndefined();
    });

    it("access invalid related node object with valueOrThrow()", () => {
        expect(() =>
            graph.transaction("error").subcategory().valueOrThrow()
        ).toThrow();
    });

    it("access invalid related node object with value()", () => {
        const subcategory = graph.transaction("error").subcategory().value();
        expect(subcategory).toBeUndefined();
    });


    it("walks relations via named functions", () => {
        const name = graph
            .transaction("tx1")
            .subcategory()
            .value()?.name;

        expect(name).toBe("sub1");
    });

    it("handles multiple entities correctly", () => {
        const name1 = graph
            .transaction("tx1")
            .subcategory()
            .value()?.name;
        const name2 = graph
            .transaction("tx2")
            .subcategory()
            .value()?.name;
        expect(name1).toBe("sub1");
        expect(name2).toBe("sub2");
    });

    it("handles multiple nodes from same entity correctly", () => {
        const expenseDesc = graph
            .transaction("tx1")
            .subcategory()
            .mainCategory()
            .expenseType()
            .value()?.description || "N/A";
        const incomeDesc = graph
            .transaction("tx1")
            .subcategory()
            .mainCategory()
            .incomeType()
            .value()?.description || "N/A";
        expect(expenseDesc).toBe("Groceries");
        expect(incomeDesc).toBe("Salary");
    });

    it("handles relations with invalid FK returning undefined", () => {
        const expenseType = graph
            .mainCategory("cat2")
            .expenseType()
            .value();
        expect(expenseType).toBeUndefined();
    });

    it("handles relations with missing property returning undefined", () => {
        const incomeType = graph
            .mainCategory("cat3")
            .expenseType()
            .value();
        expect(incomeType).toBeUndefined();
    });

    it("handles relations with invalid FK throwing on valueOrThrow()", () => {
        expect(() =>
            graph
                .mainCategory("cat2")
                .incomeType()
                .valueOrThrow()
        ).toThrow();
    });

    it("handles relations with missing property throwing on valueOrThrow()", () => {
        expect(() =>
            graph
                .mainCategory("cat3")
                .incomeType()
                .valueOrThrow()
        ).toThrow();
    });

    it("returns defined for valid relation", () => {
        expect(
            graph
                .mainCategory("cat1")
                .expenseType()
                .value()
        ).toBeDefined();
    });

    it("returns undefined for faulty relation", () => {
        expect(
            graph
                .mainCategory("cat2")
                .expenseType()
                .value()
        ).toBeUndefined();
    });

    it("returns undefined for missing relation", () => {
        expect(
            graph
                .mainCategory("cat3")
                .expenseType()
                .value()
        ).toBeUndefined();
    });

    it("throws on invalid relation", () => {
        expect(() =>
            // @ts-expect-error
            graph.transaction("tx1").mainCategory().value()
        ).toThrow();
    });

    it("returns undefined for missing entity", () => {
        const tx = graph.transaction("invalid").value();
        expect(tx).toBeUndefined();
    });

    it("traverses reverse", () => {
        const catNode = graph.mainCategory("cat1");
        const subNodes = catNode.subcategoryNodes();

        expect(subNodes).toHaveLength(2);
        expect(subNodes[0].value()?.id).toBe("sub1");
        expect(subNodes[1].value()?.id).toBe("sub2");

        const sub1Transactions = subNodes[0].transactionNodes();
        expect(sub1Transactions).toHaveLength(2);
        expect(sub1Transactions[0].value()?.id).toBe("tx1");
    });

    it("supports .map() on references to extract data", () => {
        const subNode = graph.subcategory("sub1");

        const titles = subNode.transactionNodes().filter(tn => {
            const mainCat = tn
                .subcategory()
                .mainCategory()
                .value();
            return mainCat?.name === "Food";
        }).map(tn => tn.value()?.id);

        expect(titles).toEqual(["tx1", "tx3"]);
    });

    it("supports .filter() on references to select specific nodes", () => {
        const transactions = graph.mainCategoryNodes((mc) => mc.expenseTypeId === "et1").subcategoryNodes().transactionNodes();
        console.log(transactions.map(t => t.value()?.id));
        expect(transactions).toHaveLength(3);
        expect(transactions[0].value()?.id).toBe("tx1");
    });

    it("supports .flatMap() to traverse deeper relationships", () => {
        const exNode = graph.expenseType("et1");

        const allTransactionIds = exNode
            .mainCategoryNodes()
            .subcategoryNodes()
            .transactionNodes()
            .map(tn => tn.value()?.id);

        expect(allTransactionIds).toHaveLength(3);
        expect(allTransactionIds).toEqual(["tx1", "tx3", "tx2"]);
    });

    it("chains filter and map correctly", () => {
        const exNode = graph.expenseType("et1");

        const filteredTransactionIds = exNode
            .mainCategoryNodes()
            .subcategoryNodes()
            .filter(sc => {
                const mainCat = sc
                    .mainCategory()
                    .value();
                return mainCat?.expenseTypeId === "et1";
            })
            .flatMap(sc => sc.transactionNodes())
            .map(tn => tn.value()?.id);

        expect(filteredTransactionIds).toHaveLength(3);
        expect(filteredTransactionIds).toEqual(["tx1", "tx3", "tx2"]);
    });

    it("returns an empty array for references with no matches", () => {
        const emptyGraph = createEntityGraph({
            entities: {
                transaction: [],
                subcategory: [],
                mainCategory: [],
                expenseType: [],
                incomeType: [],
            } as Entities<Schema>,
            edges: edges,
        });

        const results = emptyGraph
            .expenseType("nonexistent")
            .mainCategoryNodes();

        expect(results).toEqual([]);
    });

    it("returns an empty array (safe fallback) when the parent node does not exist", () => {
        const missingMainCategory = graph.mainCategory("nonexistent");
        const result = missingMainCategory.subcategoryNodes();

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(0);
    });

    it("returns frozen entities from value()", () => {
        const tx = graph.transaction("tx1").value();
        expect(Object.isFrozen(tx)).toBe(true);
    });

    it("returns all entities via base references", () => {
        const allTransactions = graph.transactionNodes();
        expect(allTransactions).toHaveLength(3);
        expect(allTransactions.map(t => t.value()?.id)).toEqual(["tx1", "tx2", "tx3"]);
    });

    it("filters entities via base references with where clause", () => {
        const filtered = graph.transactionNodes(t => t.subcategoryId === "sub1");
        expect(filtered).toHaveLength(2);
        expect(filtered.map(t => t.value()?.id)).toEqual(["tx1", "tx3"]);
    });

    it("returns empty array when where clause matches nothing", () => {
        const filtered = graph.transactionNodes(t => t.subcategoryId === "nonexistent");
        expect(filtered).toHaveLength(0);
    });

    it("base references return walkable nodes", () => {
        const subs = graph.subcategoryNodes();
        const names = subs.map(s => s.mainCategory().value()?.name);
        expect(names).toEqual(["Food", "Food"]);
    });

    it("base references with where and chaining", () => {
        const categories = graph.mainCategoryNodes(c => c.name === "Food");
        const expenseDescs = categories.map(c => c.expenseType().value()?.description);
        expect(expenseDescs).toContain("Groceries");
    });

    it("all() on base references returns plain objects", () => {
        const transactions = graph.transactionNodes().all();
        expect(transactions).toHaveLength(3);
        expect(transactions[0].id).toBe("tx1");
        expect(transactions[0].subcategoryId).toBe("sub1");
    });

    it("all() with where clause filters and returns plain objects", () => {
        const transactions = graph.transactionNodes(t => t.subcategoryId === "sub1").all();
        expect(transactions).toHaveLength(2);
        expect(transactions.map(t => t.id)).toEqual(["tx1", "tx3"]);
    });

    it("all() on node-level reverse references returns plain objects", () => {
        const subs = graph.mainCategory("cat1").subcategoryNodes().all();
        expect(subs).toHaveLength(2);
        expect(subs[0].name).toBe("sub1");
    });

    it("all() filters out undefined entries", () => {
        const results = graph.mainCategory("nonexistent").subcategoryNodes().all();
        expect(results).toEqual([]);
    });

    it("multi-level chained references with filter on intermediate list", () => {
        const ids = graph
            .expenseType("et1")
            .mainCategoryNodes()
            .subcategoryNodes()
            .filter(sc => sc.value()?.name === "sub1")
            .flatMap(sc => sc.transactionNodes())
            .map(tn => tn.value()?.id);

        expect(ids).toEqual(["tx1", "tx3"]);
    });

    it("multi-level chained references with filter and all()", () => {
        const subs = graph
            .expenseType("et1")
            .mainCategoryNodes()
            .subcategoryNodes()
            .filter(sc => sc.value()?.name === "sub2");

        expect(subs).toHaveLength(1);
        expect(subs[0].value()?.id).toBe("sub2");

        const transactions = subs.flatMap(sc => sc.transactionNodes());
        expect(transactions.map(t => t.value()?.id)).toEqual(["tx2"]);
    });

    it("base references with where into chained traversal", () => {
        const ids = graph
            .mainCategoryNodes(c => c.expenseTypeId === "et1")
            .subcategoryNodes()
            .transactionNodes()
            .all()
            .map(t => t.id);

        expect(ids).toEqual(["tx1", "tx3", "tx2"]);
    });

    it("base references with where that narrows results through chain", () => {
        const ids = graph
            .subcategoryNodes(s => s.name === "sub1")
            .transactionNodes()
            .all()
            .map(t => t.id);

        expect(ids).toEqual(["tx1", "tx3"]);
    });

    it("chained references with multiple filters at different levels", () => {
        const descriptions = graph
            .transactionNodes(t => t.subcategoryId === "sub1")
            .subcategoryNodes()
            .mainCategoryNodes(c => c.expenseTypeId === "et1")
            .expenseTypeNodes()
            .all()
            .map(e => e.description);

        expect(descriptions).toEqual(["Groceries", "Groceries"]);
    });

    it("chained where on reverse references at multiple levels", () => {
        const ids = graph
            .expenseType("et1")
            .mainCategoryNodes(c => c.name === "Food")
            .subcategoryNodes(s => s.name === "sub1")
            .transactionNodes()
            .all()
            .map(t => t.id);

        expect(ids).toEqual(["tx1", "tx3"]);
    });

    it("chained where on forward edges at multiple levels", () => {
        const results = graph
            .transactionNodes(t => t.subcategoryId === "sub1")
            .subcategoryNodes(s => s.mainCategoryId === "cat1")
            .mainCategoryNodes(c => c.expenseTypeId === "et1")
            .all();

        expect(results).toHaveLength(2);
        expect(results[0].name).toBe("Food");
    });

    it("chained where filters out non-matching at each level", () => {
        const ids = graph
            .mainCategoryNodes(c => c.expenseTypeId === "et1")
            .subcategoryNodes(s => s.name === "sub2")
            .transactionNodes(t => t.subcategoryId === "sub2")
            .all()
            .map(t => t.id);

        expect(ids).toEqual(["tx2"]);
    });

    it("chained where that filters everything out", () => {
        const ids = graph
            .expenseType("et1")
            .mainCategoryNodes(c => c.name === "NonExistent")
            .subcategoryNodes()
            .all();

        expect(ids).toHaveLength(0);
    });

    it("allUnique() removes duplicate entities from chained traversal", () => {
        const categories = graph
            .mainCategory("cat1")
            .subcategoryNodes()
            .mainCategoryNodes()
            .all();

        expect(categories).toHaveLength(2);
        expect(categories[0].id).toBe("cat1");
        expect(categories[1].id).toBe("cat1");

        const unique = graph
            .mainCategory("cat1")
            .subcategoryNodes()
            .mainCategoryNodes()
            .allUnique();

        expect(unique).toHaveLength(1);
        expect(unique[0].id).toBe("cat1");
    });

    it("allUnique() on base references with no duplicates", () => {
        const subs = graph.subcategoryNodes().allUnique();
        expect(subs).toHaveLength(2);
        expect(subs.map(s => s.id)).toEqual(["sub1", "sub2"]);
    });

    it("allUnique() returns empty for missing entities", () => {
        const result = graph
            .mainCategory("nonexistent")
            .subcategoryNodes()
            .allUnique();

        expect(result).toHaveLength(0);
    });

    it("allUnique() on deep chain with duplicates", () => {
        const transactions = graph
            .expenseType("et1")
            .mainCategoryNodes()
            .subcategoryNodes()
            .mainCategoryNodes()
            .allUnique();

        expect(transactions).toHaveLength(1);
        expect(transactions[0].id).toBe("cat1");
    });

    it("where() filters current list by predicate", () => {
        const subs = graph
            .mainCategoryNodes()
            .where(s => s.name === "sub1");

        expect(subs).toHaveLength(0);

        const filtered = graph
            .subcategoryNodes()
            .where(s => s.name === "sub1");

        expect(filtered).toHaveLength(1);
        expect(filtered[0].value()?.id).toBe("sub1");
    });

    it("where() returns walkable EntityNodeList", () => {
        const txIds = graph
            .subcategoryNodes()
            .where(s => s.name === "sub1")
            .transactionNodes()
            .all()
            .map(t => t.id);

        expect(txIds).toEqual(["tx1", "tx3"]);
    });

    it("where() returns empty list when nothing matches", () => {
        const result = graph
            .subcategoryNodes()
            .where(s => s.name === "nonexistent");

        expect(result).toHaveLength(0);
    });

    it("where() chained after reverse reference traversal", () => {
        const cats = graph
            .expenseType("et1")
            .mainCategoryNodes()
            .subcategoryNodes()
            .where(s => s.name === "sub2")
            .all();

        expect(cats).toHaveLength(1);
        expect(cats[0].id).toBe("sub2");
    });

    it("where() can chain further into forward and reverse edges", () => {
        const txIds = graph
            .expenseType("et1")
            .mainCategoryNodes()
            .subcategoryNodes()
            .where(s => s.name === "sub2")
            .transactionNodes()
            .all()
            .map(t => t.id);

        expect(txIds).toEqual(["tx2"]);
    });

});
