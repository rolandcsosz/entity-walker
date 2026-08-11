import { GraphDef, GraphEdges, ValidSchema } from "../src/core/types";

export type Transaction = { id: string; subcategoryId: string; amount?: number; archived?: boolean };
export type Subcategory = { id: string; name: string, mainCategoryId: string };
export type MainCategory = { id: string; name: string; expenseTypeId?: string; incomeTypeId?: string };
export type ExpenseType = { id: string; description: string };
export type IncomeType = { id: string; description: string };

export type Schema = ValidSchema<{
    transaction: Transaction;
    subcategory: Subcategory;
    mainCategory: MainCategory;
    expenseType: ExpenseType;
    incomeType: IncomeType;
}>;

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
            resolve: (s) => s.mainCategoryId,
        },
    },
    mainCategory: {
        expenseType: {
            bidirectional: true,
            resolve: (m) => m.expenseTypeId,
        },
        incomeType: {
            resolve: (m) => m.incomeTypeId,
        },
    },
} as const satisfies GraphEdges<Schema>;

export type CustomGraph = GraphDef<Schema, typeof edges>;

export type TransactionN  = { id: number; subcategoryId: number };
export type SubcategoryN  = { id: number; name: string; mainCategoryId: number };
export type MainCategoryN = { id: number; name: string; expenseTypeId?: number; incomeTypeId?: number };
export type ExpenseTypeN  = { id: number; description: string };
export type IncomeTypeN   = { id: number; description: string };

export type SchemaNumeric = ValidSchema<{
    transaction:  TransactionN;
    subcategory:  SubcategoryN;
    mainCategory: MainCategoryN;
    expenseType:  ExpenseTypeN;
    incomeType:   IncomeTypeN;
}>;

export const numericEdges = {
    transaction: {
        subcategory: {
            bidirectional: true,
            resolve: (t: TransactionN) => t.subcategoryId,
        },
    },
    subcategory: {
        mainCategory: {
            bidirectional: true,
            resolve: (s: SubcategoryN) => s.mainCategoryId,
        },
    },
    mainCategory: {
        expenseType: {
            bidirectional: true,
            resolve: (m: MainCategoryN) => m.expenseTypeId,
        },
        incomeType: {
            resolve: (m: MainCategoryN) => m.incomeTypeId,
        },
    },
} as const satisfies GraphEdges<SchemaNumeric>;