import { GraphDef, GraphEdges } from "../src/types";

export type Transaction = { id: string; subcategoryId: string };
export type Subcategory = { id: string; name: string, mainCategoryId: string };
export type MainCategory = { id: string; name: string; expenseTypeId?: string; incomeTypeId?: string };
export type ExpenseType = { id: string; description: string };
export type IncomeType = { id: string; description: string };

export type Schema = {
    transaction: Transaction;
    subcategory: Subcategory;
    mainCategory: MainCategory;
    expenseType: ExpenseType;
    incomeType: IncomeType;
}

export const edges = {
    transaction: {
        subcategory: {
            bidirectional: true,
            resolve: (t) => t.subcategoryId,
        },
    },
    subcategory: {
        mainCategory: {
            bidirectional: true,
            optional: true,
            resolve: (s) => s.mainCategoryId,
        },
    },
    mainCategory: {
        expenseType: {
            optional: true,
            bidirectional: true,
            resolve: (m) => m.expenseTypeId,
        },
        incomeType: {
            resolve: (m) => m.incomeTypeId,
        },
    },
} as const satisfies GraphEdges<Schema>;

export type CustomGraph = GraphDef<Schema, typeof edges>;