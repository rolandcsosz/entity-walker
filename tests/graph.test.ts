
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
            .subcategoryId;

        expect(subcategoryId).toBe("sub1");
    });

    it("access invalid first node object with get()", () => {
        expect(() => {
            graph.transaction("error").get();
        }).toThrow();
    });

    it("access invalid first node object with tryGet()", () => {
        const transaction = graph.transaction("error").tryGet();
        expect(transaction).toBeUndefined();
    });

    it("access invalid related node object with get()", () => {
        expect(() =>
            graph.transaction("error").subcategory().get()
        ).toThrow();
    });

    it("access invalid related node object with tryGet()", () => {
        const subcategory = graph.transaction("error").subcategory().tryGet();
        expect(subcategory).toBeUndefined();
    });


    it("walks relations via named functions", () => {
        const name = graph
            .transaction("tx1")
            .subcategory()
            .get().name;

        expect(name).toBe("sub1");
    });

    it("handles multiple entities correctly", () => {
        const name1 = graph
            .transaction("tx1")
            .subcategory()
            .get().name;
        const name2 = graph
            .transaction("tx2")
            .subcategory()
            .get().name;
        expect(name1).toBe("sub1");
        expect(name2).toBe("sub2");
    });

    it("handles multiple nodes from same entity correctly", () => {
        const expenseDesc = graph
            .transaction("tx1")
            .subcategory()
            .mainCategory()
            .expenseType()
            .tryGet()?.description || "N/A";
        const incomeDesc = graph
            .transaction("tx1")
            .subcategory()
            .mainCategory()
            .incomeType()
            .tryGet()?.description || "N/A";
        expect(expenseDesc).toBe("Groceries");
        expect(incomeDesc).toBe("Salary");
    });

    it("handles optional relations with invalid FK", () => {
        const expenseType = graph
            .mainCategory("cat2")
            .expenseType()
            .tryGet();
        expect(expenseType).toBeUndefined();
    });

    it("handles optional relations with missing property", () => {
        const incomeType = graph
            .mainCategory("cat3")
            .expenseType()
            .tryGet();
        expect(incomeType).toBeUndefined();
    });

    it("handles relations with invalid FK", () => {
        expect(() =>
            graph
                .mainCategory("cat2")
                .incomeType()
                .get()
        ).toThrow();
    });

    it("handles relations with missing property", () => {
        expect(() =>
            graph
                .mainCategory("cat3")
                .incomeType()
                .get()
        ).toThrow();
    });

    it("checks existence of valid optinonal relation", () => {
        expect(
            graph
                .mainCategory("cat1")
                .expenseType()
                .exists()
        ).toBe(true);
    });

    it("checks existence of faulty optional relation", () => {
        expect(
            graph
                .mainCategory("cat2")
                .expenseType()
                .exists()
        ).toBe(false);
    });

    it("checks existence of not existing optional relation", () => {
        expect(
            graph
                .mainCategory("cat3")
                .expenseType()
                .exists()
        ).toBe(false);
    });

    it("throws on invalid relation", () => {
        expect(() =>
            // @ts-expect-error
            graph.transaction("tx1").mainCategory().get()
        ).toThrow();
    });

    it("throws on missing entity", () => {
        expect(() =>
            graph.transaction("invalid").get()
        ).toThrow();
    });

    it("traverses reverse", () => {
        const catNode = graph.mainCategory("cat1");
        const subNodes = catNode.subcategoryReferences();

        expect(subNodes).toHaveLength(2);
        expect(subNodes[0].get().id).toBe("sub1");
        expect(subNodes[1].get().id).toBe("sub2");

        const sub1Transactions = subNodes[0].transactionReferences();
        expect(sub1Transactions).toHaveLength(2);
        expect(sub1Transactions[0].get().id).toBe("tx1");
    });

    it("supports .map() on references to extract data", () => {
        const subNode = graph.subcategory("sub1");

        const titles = subNode.transactionReferences().filter(tn => {
            const mainCat = tn
                .subcategory()
                .mainCategory()
                .tryGet();
            return mainCat?.name === "Food";
        }).map(tn => tn.get().id);

        expect(titles).toEqual(["tx1", "tx3"]);
    });

    it("supports .filter() on references to select specific nodes", () => {
        const subNode = graph.subcategory("sub1");

        const transactions = subNode.transactionReferences().filter(
            (tn) => {
                const mainCat = tn
                    .subcategory()
                    .mainCategory()
                    .tryGet();
                return mainCat?.expenseTypeId === "et1";
            }
        );

        expect(transactions).toHaveLength(2);
        expect(transactions[0].get().id).toBe("tx1");
    });

    it("supports .flatMap() to traverse deeper relationships", () => {
        const exNode = graph.expenseType("et1");

        const allTransactionIds = exNode
            .mainCategoryReferences()
            .flatMap(mc => mc.subcategoryReferences())
            .flatMap(sc => sc.transactionReferences())
            .map(tn => tn.get().id);

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
                    .tryGet();
                return mainCat?.expenseTypeId === "et1";
            })
            .flatMap(sc => sc.transactionReferences())
            .map(tn => tn.get().id);

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
