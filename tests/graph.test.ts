
import { describe, it, expect } from "vitest";
import { createEntityGraph } from "../src/graph";
import { EntityGraph, GraphDef, GraphEdges } from "../src/types";


type Transaction = { id: string; subcategoryId: string };
type Subcategory = { id: string; name: string, mainCategoryId: string };
type MainCategory = { id: string; name: string; expenseTypeId?: string; incomeTypeId?: string };
type ExpenseType = { id: string; description: string };
type IncomeType = { id: string; description: string };

type Schema = {
    transaction: Transaction;
    subcategory: Subcategory;
    mainCategory: MainCategory;
    expenseType: ExpenseType;
    incomeType: IncomeType;
}

const entities = {
    transaction: [
        { id: "tx1", subcategoryId: "sub1" }, { id: "tx2", subcategoryId: "sub2" },
    ],
    subcategory: [
        { id: "sub1", name: "sub1", mainCategoryId: "cat1" }, { id: "sub2", name: "sub2", mainCategoryId: "cat1" },
    ],
    mainCategory: [
        { id: "cat1", name: "Food", expenseTypeId: "et1", incomeTypeId: "it1" },
        { id: "cat2", name: "Food", expenseTypeId: "error", incomeTypeId: "error" },
        { id: "cat3", name: "Food" },
    ],
    expenseType: [{ id: "et1", description: "Groceries" }],
    incomeType: [{ id: "it1", description: "Salary" }],
};

const edges = {
    transaction: {
        subcategory: {
            to: "subcategory",
            bidirectional: true,
            resolve: (t) => t.subcategoryId,
        },
    },
    subcategory: {
        mainCategory: {
            to: "mainCategory",
            bidirectional: true,
            optional: true,
            resolve: (s) => s.mainCategoryId,
        },
    },
    mainCategory: {
        expenseType: {
            to: "expenseType",
            optional: true,
            resolve: (m) => m.expenseTypeId,
        },
        incomeType: {
            to: "incomeType",
            resolve: (m) => m.incomeTypeId,
        }
    },
} as const satisfies GraphEdges<Schema>;


type CustomGraph = GraphDef<Schema, typeof edges>;

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

    it("handles optional relations with invalid FK", () => {
        const expenseType = graph
            .mainCategory("cat2")
            .expenseType()
            .get();
        expect(expenseType).toBeUndefined();
    });

    it("handles optional relations with missing property", () => {
        const incomeType = graph
            .mainCategory("cat3")
            .expenseType()
            .get();
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

    it("handles optional relations with missing property", () => {
        expect(() =>
            graph
                .mainCategory("cat3")
                .incomeType()
                .get()
        ).toThrow();
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
        expect(sub1Transactions).toHaveLength(1);
        expect(sub1Transactions[0].get().id).toBe("tx1");
    });
});
