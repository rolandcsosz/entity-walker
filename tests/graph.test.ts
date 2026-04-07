
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
            .transaction("tx1").get()
            ?.subcategoryId;

        expect(subcategoryId).toBe("sub1");
    });

    it("access invalid first node object with getOrThrow()", () => {
        expect(() => {
            graph.transaction("error").getOrThrow();
        }).toThrow();
    });

    it("access invalid first node object with get()", () => {
        const transaction = graph.transaction("error").get();
        expect(transaction).toBeUndefined();
    });

    it("access invalid related node object with getOrThrow()", () => {
        expect(() =>
            graph.transaction("error").subcategory().getOrThrow()
        ).toThrow();
    });

    it("access invalid related node object with get()", () => {
        const subcategory = graph.transaction("error").subcategory().get();
        expect(subcategory).toBeUndefined();
    });


    it("walks relations via named functions", () => {
        const name = graph
            .transaction("tx1")
            .subcategory()
            .get()?.name;

        expect(name).toBe("sub1");
    });

    it("handles multiple entities correctly", () => {
        const name1 = graph
            .transaction("tx1")
            .subcategory()
            .get()?.name;
        const name2 = graph
            .transaction("tx2")
            .subcategory()
            .get()?.name;
        expect(name1).toBe("sub1");
        expect(name2).toBe("sub2");
    });

    it("handles multiple nodes from same entity correctly", () => {
        const expenseDesc = graph
            .transaction("tx1")
            .subcategory()
            .mainCategory()
            .expenseType()
            .get()?.description || "N/A";
        const incomeDesc = graph
            .transaction("tx1")
            .subcategory()
            .mainCategory()
            .incomeType()
            .get()?.description || "N/A";
        expect(expenseDesc).toBe("Groceries");
        expect(incomeDesc).toBe("Salary");
    });

    it("handles relations with invalid FK returning undefined", () => {
        const expenseType = graph
            .mainCategory("cat2")
            .expenseType()
            .get();
        expect(expenseType).toBeUndefined();
    });

    it("handles relations with missing property returning undefined", () => {
        const incomeType = graph
            .mainCategory("cat3")
            .expenseType()
            .get();
        expect(incomeType).toBeUndefined();
    });

    it("handles relations with invalid FK throwing on getOrThrow()", () => {
        expect(() =>
            graph
                .mainCategory("cat2")
                .incomeType()
                .getOrThrow()
        ).toThrow();
    });

    it("handles relations with missing property throwing on getOrThrow()", () => {
        expect(() =>
            graph
                .mainCategory("cat3")
                .incomeType()
                .getOrThrow()
        ).toThrow();
    });

    it("returns defined for valid relation", () => {
        expect(
            graph
                .mainCategory("cat1")
                .expenseType()
                .get()
        ).toBeDefined();
    });

    it("returns undefined for faulty relation", () => {
        expect(
            graph
                .mainCategory("cat2")
                .expenseType()
                .get()
        ).toBeUndefined();
    });

    it("returns undefined for missing relation", () => {
        expect(
            graph
                .mainCategory("cat3")
                .expenseType()
                .get()
        ).toBeUndefined();
    });

    it("throws on invalid relation", () => {
        expect(() =>
            // @ts-expect-error
            graph.transaction("tx1").mainCategory().get()
        ).toThrow();
    });

    it("returns undefined for missing entity", () => {
        const tx = graph.transaction("invalid").get();
        expect(tx).toBeUndefined();
    });

    it("traverses reverse", () => {
        const catNode = graph.mainCategory("cat1");
        const subNodes = catNode.subcategoryReferences();

        expect(subNodes).toHaveLength(2);
        expect(subNodes[0].get()?.id).toBe("sub1");
        expect(subNodes[1].get()?.id).toBe("sub2");

        const sub1Transactions = subNodes[0].transactionReferences();
        expect(sub1Transactions).toHaveLength(2);
        expect(sub1Transactions[0].get()?.id).toBe("tx1");
    });

    it("supports .map() on references to extract data", () => {
        const subNode = graph.subcategory("sub1");

        const titles = subNode.transactionReferences().filter(tn => {
            const mainCat = tn
                .subcategory()
                .mainCategory()
                .get();
            return mainCat?.name === "Food";
        }).map(tn => tn.get()?.id);

        expect(titles).toEqual(["tx1", "tx3"]);
    });

    it("supports .filter() on references to select specific nodes", () => {
        const transactions = graph.mainCategoryReferences((mc) => mc?.expenseTypeId === "et1").subcategoryReferences().transactionReferences();
        console.log(transactions.map(t => t.get()?.id));
        expect(transactions).toHaveLength(3);
        expect(transactions[0].get()?.id).toBe("tx1");
    });

    it("supports .flatMap() to traverse deeper relationships", () => {
        const exNode = graph.expenseType("et1");

        const allTransactionIds = exNode
            .mainCategoryReferences()
            .subcategoryReferences()
            .transactionReferences()
            .map(tn => tn.get()?.id);

        expect(allTransactionIds).toHaveLength(3);
        expect(allTransactionIds).toEqual(["tx1", "tx3", "tx2"]);
    });

    it("chains filter and map correctly", () => {
        const exNode = graph.expenseType("et1");

        const filteredTransactionIds = exNode
            .mainCategoryReferences()
            .subcategoryReferences()
            .filter(sc => {
                const mainCat = sc
                    .mainCategory()
                    .get();
                return mainCat?.expenseTypeId === "et1";
            })
            .flatMap(sc => sc.transactionReferences())
            .map(tn => tn.get()?.id);

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
            .mainCategoryReferences();

        expect(results).toEqual([]);
    });

    it("returns an empty array (safe fallback) when the parent node does not exist", () => {
        const missingMainCategory = graph.mainCategory("nonexistent");
        const result = missingMainCategory.subcategoryReferences();

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(0);
    });

    it("returns frozen entities from get()", () => {
        const tx = graph.transaction("tx1").get();
        expect(Object.isFrozen(tx)).toBe(true);
    });

    it("returns all entities via base references", () => {
        const allTransactions = graph.transactionReferences();
        expect(allTransactions).toHaveLength(3);
        expect(allTransactions.map(t => t.get()?.id)).toEqual(["tx1", "tx2", "tx3"]);
    });

    it("filters entities via base references with where clause", () => {
        const filtered = graph.transactionReferences(t => t.subcategoryId === "sub1");
        expect(filtered).toHaveLength(2);
        expect(filtered.map(t => t.get()?.id)).toEqual(["tx1", "tx3"]);
    });

    it("returns empty array when where clause matches nothing", () => {
        const filtered = graph.transactionReferences(t => t.subcategoryId === "nonexistent");
        expect(filtered).toHaveLength(0);
    });

    it("base references return walkable nodes", () => {
        const subs = graph.subcategoryReferences();
        const names = subs.map(s => s.mainCategory().get()?.name);
        expect(names).toEqual(["Food", "Food"]);
    });

    it("base references with where and chaining", () => {
        const categories = graph.mainCategoryReferences(c => c.name === "Food");
        const expenseDescs = categories.map(c => c.expenseType().get()?.description);
        expect(expenseDescs).toContain("Groceries");
    });

    it("getAll() on base references returns plain objects", () => {
        const transactions = graph.transactionReferences().getAll();
        expect(transactions).toHaveLength(3);
        expect(transactions[0].id).toBe("tx1");
        expect(transactions[0].subcategoryId).toBe("sub1");
    });

    it("getAll() with where clause filters and returns plain objects", () => {
        const transactions = graph.transactionReferences(t => t.subcategoryId === "sub1").getAll();
        expect(transactions).toHaveLength(2);
        expect(transactions.map(t => t.id)).toEqual(["tx1", "tx3"]);
    });

    it("getAll() on node-level reverse references returns plain objects", () => {
        const subs = graph.mainCategory("cat1").subcategoryReferences().getAll();
        expect(subs).toHaveLength(2);
        expect(subs[0].name).toBe("sub1");
    });

    it("getAll() filters out undefined entries", () => {
        const results = graph.mainCategory("nonexistent").subcategoryReferences().getAll();
        expect(results).toEqual([]);
    });

    it("multi-level chained references with filter on intermediate list", () => {
        const ids = graph
            .expenseType("et1")
            .mainCategoryReferences()
            .subcategoryReferences()
            .filter(sc => sc.get()?.name === "sub1")
            .flatMap(sc => sc.transactionReferences())
            .map(tn => tn.get()?.id);

        expect(ids).toEqual(["tx1", "tx3"]);
    });

    it("multi-level chained references with filter and getAll()", () => {
        const subs = graph
            .expenseType("et1")
            .mainCategoryReferences()
            .subcategoryReferences()
            .filter(sc => sc.get()?.name === "sub2");

        expect(subs).toHaveLength(1);
        expect(subs[0].get()?.id).toBe("sub2");

        const transactions = subs.flatMap(sc => sc.transactionReferences());
        expect(transactions.map(t => t.get()?.id)).toEqual(["tx2"]);
    });

    it("base references with where into chained traversal", () => {
        const ids = graph
            .mainCategoryReferences(c => c.expenseTypeId === "et1")
            .subcategoryReferences()
            .transactionReferences()
            .getAll()
            .map(t => t.id);

        expect(ids).toEqual(["tx1", "tx3", "tx2"]);
    });

    it("base references with where that narrows results through chain", () => {
        const ids = graph
            .subcategoryReferences(s => s.name === "sub1")
            .transactionReferences()
            .getAll()
            .map(t => t.id);

        expect(ids).toEqual(["tx1", "tx3"]);
    });

    it("chained references with multiple filters at different levels", () => {
        const descriptions = graph
            .transactionReferences(t => t.subcategoryId === "sub1")
            .subcategory()
            .mainCategory()
            .expenseType()
            .getAll()
            .map(e => e.description);

        expect(descriptions).toEqual(["Groceries", "Groceries"]);
    });

    it("chained where on reverse references at multiple levels", () => {
        const ids = graph
            .expenseType("et1")
            .mainCategoryReferences(c => c.name === "Food")
            .subcategoryReferences(s => s.name === "sub1")
            .transactionReferences()
            .getAll()
            .map(t => t.id);

        expect(ids).toEqual(["tx1", "tx3"]);
    });

    it("chained where on forward edges at multiple levels", () => {
        const results = graph
            .transactionReferences(t => t.subcategoryId === "sub1")
            .subcategory(s => s.mainCategoryId === "cat1")
            .mainCategory(c => c.expenseTypeId === "et1")
            .getAll();

        expect(results).toHaveLength(2);
        expect(results[0].name).toBe("Food");
    });

    it("chained where filters out non-matching at each level", () => {
        const ids = graph
            .mainCategoryReferences(c => c.expenseTypeId === "et1")
            .subcategoryReferences(s => s.name === "sub2")
            .transactionReferences(t => t.subcategoryId === "sub2")
            .getAll()
            .map(t => t.id);

        expect(ids).toEqual(["tx2"]);
    });

    it("chained where that filters everything out", () => {
        const ids = graph
            .expenseType("et1")
            .mainCategoryReferences(c => c.name === "NonExistent")
            .subcategoryReferences()
            .getAll();

        expect(ids).toHaveLength(0);
    });

    it("getAllWitoutDuplicates() removes duplicate entities from chained traversal", () => {
        const categories = graph
            .mainCategory("cat1")
            .subcategoryReferences()
            .mainCategory()
            .getAll();

        expect(categories).toHaveLength(2);
        expect(categories[0].id).toBe("cat1");
        expect(categories[1].id).toBe("cat1");

        const unique = graph
            .mainCategory("cat1")
            .subcategoryReferences()
            .mainCategory()
            .getAllWitoutDuplicates();

        expect(unique).toHaveLength(1);
        expect(unique[0].id).toBe("cat1");
    });

    it("getAllWitoutDuplicates() on base references with no duplicates", () => {
        const subs = graph.subcategoryReferences().getAllWitoutDuplicates();
        expect(subs).toHaveLength(2);
        expect(subs.map(s => s.id)).toEqual(["sub1", "sub2"]);
    });

    it("getAllWitoutDuplicates() returns empty for missing entities", () => {
        const result = graph
            .mainCategory("nonexistent")
            .subcategoryReferences()
            .getAllWitoutDuplicates();

        expect(result).toHaveLength(0);
    });

    it("getAllWitoutDuplicates() on deep chain with duplicates", () => {
        const transactions = graph
            .expenseType("et1")
            .mainCategoryReferences()
            .subcategoryReferences()
            .mainCategory()
            .getAllWitoutDuplicates()

        expect(transactions).toHaveLength(1);
        expect(transactions[0].id).toBe("cat1");
    });

});
