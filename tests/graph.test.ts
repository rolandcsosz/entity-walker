
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

const graph: EntityGraph<CustomGraph> = createEntityGraph<Schema>().create({
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
        const subNode = graph.subcategory("sub1");

        const transactions = subNode.transactionReferences().filter(
            (tn) => {
                const mainCat = tn
                    .subcategory()
                    .mainCategory()
                    .get();
                return mainCat?.expenseTypeId === "et1";
            }
        );

        expect(transactions).toHaveLength(2);
        expect(transactions[0].get()?.id).toBe("tx1");
    });

    it("supports .flatMap() to traverse deeper relationships", () => {
        const exNode = graph.expenseType("et1");

        const allTransactionIds = exNode
            .mainCategoryReferences()
            .flatMap(mc => mc.subcategoryReferences())
            .flatMap(sc => sc.transactionReferences())
            .map(tn => tn.get()?.id);

        expect(allTransactionIds).toHaveLength(3);
        expect(allTransactionIds).toEqual(["tx1", "tx3", "tx2"]);
    });

    it("chains filter and map correctly", () => {
        const exNode = graph.expenseType("et1");

        const filteredTransactionIds = exNode
            .mainCategoryReferences()
            .flatMap(mc => mc.subcategoryReferences())
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
        const emptyGraph = createEntityGraph<Schema>().create({
            entities: {
                transaction: [],
                subcategory: [],
                mainCategory: [],
                expenseType: [],
                incomeType: [],
            },
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

});
