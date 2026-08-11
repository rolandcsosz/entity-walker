import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createGraph, type ValidSchema, type GraphEdges, type GraphDef, type ValidApi, type Entities } from "../../src";
import { client } from "./generated/client/client.gen";
import {
    getTransactions,
    getTransaction,
    createTransaction,
    updateTransaction,
    deleteTransaction,
    getSubcategories,
    getSubcategory,
    createSubcategory,
    updateSubcategory,
    deleteSubcategory,
    getMainCategories,
    getMainCategory,
    createMainCategory,
    updateMainCategory,
    deleteMainCategory,
    getExpenseTypes,
    getTransactionTypes,
    getTemplates,
    getTemplate,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    type Transaction,
    type Subcategory,
    type MainCategory,
    type ExpenseType,
    type TransactionType,
    type Template,
    ErrorResponse,
} from "./generated/client";

export type OpenApiSchema = ValidSchema<{
    transaction: Transaction;
    subcategory: Subcategory;
    mainCategory: MainCategory;
    expenseType: ExpenseType;
    transactionType: TransactionType;
    template: Template;
}>;

export const openApiEdges = {
    transaction: {
        subcategory: {
            bidirectional: true,
            resolve: (t: Transaction) => t.subcategoryId,
        },
    },
    subcategory: {
        mainCategory: {
            bidirectional: true,
            resolve: (s: Subcategory) => s.mainCategoryId,
        },
        expenseType: {
            bidirectional: true,
            resolve: (s: Subcategory) => s.expenseTypeId,
        },
    },
    mainCategory: {
        expenseType: {
            bidirectional: true,
            resolve: (m: MainCategory) => m.expenseTypeId,
        },
        transactionType: {
            bidirectional: true,
            resolve: (m: MainCategory) => m.transactionTypeId,
        },
    },
    template: {
        subcategory: {
            bidirectional: true,
            resolve: (tmp: Template) => tmp.subcategoryId,
        },
    },
} as const satisfies GraphEdges<OpenApiSchema>;

export type OpenApiGraphDef = GraphDef<OpenApiSchema, typeof openApiEdges>;

describe("OpenAPI Client Integration with ApiGraph", () => {
    let mockDb: {
        transactions: Map<string, Transaction>;
        subcategories: Map<string, Subcategory>;
        mainCategories: Map<string, MainCategory>;
        expenseTypes: Map<string, ExpenseType>;
        transactionTypes: Map<string, TransactionType>;
        templates: Map<string, Template>;
    };

    beforeEach(() => {
        mockDb = {
            transactions: new Map([
                [
                    "tx1",
                    {
                        id: "tx1",
                        item: "Coffee",
                        amount: 4.5,
                        date: "2026-08-09",
                        subcategoryId: "sub1",
                    },
                ],
                [
                    "tx2",
                    {
                        id: "tx2",
                        item: "Book",
                        amount: 19.99,
                        date: "2026-08-09",
                        subcategoryId: "sub1",
                    },
                ],
            ]),
            subcategories: new Map([
                [
                    "sub1",
                    {
                        id: "sub1",
                        name: "Groceries & Cafe",
                        mainCategoryId: "mc1",
                        expenseTypeId: "exp1",
                    },
                ],
            ]),
            mainCategories: new Map([
                [
                    "mc1",
                    {
                        id: "mc1",
                        name: "Daily Expenses",
                        expenseTypeId: "exp1",
                        transactionTypeId: "tt1",
                    },
                ],
            ]),
            expenseTypes: new Map([
                [
                    "exp1",
                    {
                        id: "exp1",
                        name: "Food & Household",
                    },
                ],
            ]),
            transactionTypes: new Map([
                [
                    "tt1",
                    {
                        id: "tt1",
                        name: "Expense",
                    },
                ],
            ]),
            templates: new Map([
                [
                    "tpl1",
                    {
                        id: "tpl1",
                        name: "Weekly Coffee",
                        itemName: "Espresso",
                        amount: 4.5,
                        date: null,
                        subcategoryId: "sub1",
                    },
                ],
            ]),
        };

        client.setConfig({
            baseUrl: "http://api.mock.test",
        });

        vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
            const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
            const method = (init?.method || (input instanceof Request ? input.method : "GET") || "GET").toUpperCase();
            const url = new URL(urlStr, "http://api.mock.test");
            const pathname = url.pathname;

            let responseBody: any = null;
            let status = 200;

            if (pathname === "/transactions") {
                if (method === "GET") {
                    responseBody = Array.from(mockDb.transactions.values());
                } else if (method === "POST") {
                    const bodyText = init?.body ? (init.body as string) : input instanceof Request ? await input.text() : "{}";
                    const body = JSON.parse(bodyText || "{}");
                    const newId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
                    const created: Transaction = { id: newId, ...body };
                    mockDb.transactions.set(newId, created);
                    responseBody = created;
                    status = 200;
                }
            } else if (pathname.startsWith("/transactions/")) {
                const id = pathname.split("/")[2];
                if (method === "GET") {
                    const found = mockDb.transactions.get(id);
                    if (found) {
                        responseBody = found;
                    } else {
                        status = 404;
                        responseBody = { message: "Transaction not found" };
                    }
                } else if (method === "PUT") {
                    const bodyText = init?.body ? (init.body as string) : input instanceof Request ? await input.text() : "{}";
                    const body = JSON.parse(bodyText || "{}");
                    const existing = mockDb.transactions.get(id);
                    if (existing) {
                        const updated: Transaction = { ...existing, ...body, id };
                        mockDb.transactions.set(id, updated);
                        responseBody = updated;
                    } else {
                        status = 404;
                        responseBody = { message: "Transaction not found" };
                    }
                } else if (method === "DELETE") {
                    if (mockDb.transactions.has(id)) {
                        mockDb.transactions.delete(id);
                        responseBody = { success: true };
                    } else {
                        status = 404;
                        responseBody = { message: "Transaction not found" };
                    }
                }
            } else if (pathname === "/subcategories") {
                if (method === "GET") {
                    responseBody = Array.from(mockDb.subcategories.values());
                } else if (method === "POST") {
                    const bodyText = init?.body ? (init.body as string) : input instanceof Request ? await input.text() : "{}";
                    const body = JSON.parse(bodyText || "{}");
                    const newId = `sub_${Date.now()}`;
                    const created: Subcategory = { id: newId, expenseTypeId: "exp1", ...body };
                    mockDb.subcategories.set(newId, created);
                    responseBody = created;
                    status = 200;
                }
            } else if (pathname.startsWith("/subcategories/")) {
                const id = pathname.split("/")[2];
                if (method === "GET") {
                    const found = mockDb.subcategories.get(id);
                    if (found) responseBody = found;
                    else {
                        status = 404;
                        responseBody = { message: "Subcategory not found" };
                    }
                } else if (method === "PUT") {
                    const bodyText = init?.body ? (init.body as string) : input instanceof Request ? await input.text() : "{}";
                    const body = JSON.parse(bodyText || "{}");
                    const existing = mockDb.subcategories.get(id);
                    const updated: Subcategory = { expenseTypeId: "exp1", mainCategoryId: "mc1", name: "", ...existing, ...body, id };
                    mockDb.subcategories.set(id, updated);
                    responseBody = updated;
                } else if (method === "DELETE") {
                    mockDb.subcategories.delete(id);
                    responseBody = { success: true };
                }
            } else if (pathname === "/main_categories") {
                if (method === "GET") {
                    responseBody = Array.from(mockDb.mainCategories.values());
                }
            } else if (pathname.startsWith("/main_categories/")) {
                const id = pathname.split("/")[2];
                if (method === "GET") {
                    const found = mockDb.mainCategories.get(id);
                    if (found) responseBody = found;
                    else {
                        status = 404;
                        responseBody = { message: "MainCategory not found" };
                    }
                }
            } else if (pathname === "/expense_types") {
                if (method === "GET") {
                    responseBody = Array.from(mockDb.expenseTypes.values());
                }
            } else if (pathname === "/transaction_types") {
                if (method === "GET") {
                    responseBody = Array.from(mockDb.transactionTypes.values());
                }
            } else if (pathname === "/templates") {
                if (method === "GET") {
                    responseBody = Array.from(mockDb.templates.values());
                } else if (method === "POST") {
                    const bodyText = init?.body ? (init.body as string) : input instanceof Request ? await input.text() : "{}";
                    const body = JSON.parse(bodyText || "{}");
                    const newId = `tpl_${Date.now()}`;
                    const created: Template = { id: newId, ...body };
                    mockDb.templates.set(newId, created);
                    responseBody = created;
                    status = 200;
                }
            } else if (pathname.startsWith("/templates/")) {
                const id = pathname.split("/")[2];
                if (method === "GET") {
                    const found = mockDb.templates.get(id);
                    if (found) responseBody = found;
                    else {
                        status = 404;
                        responseBody = { message: "Template not found" };
                    }
                } else if (method === "PUT") {
                    const bodyText = init?.body ? (init.body as string) : input instanceof Request ? await input.text() : "{}";
                    const body = JSON.parse(bodyText || "{}");
                    const existing = mockDb.templates.get(id);
                    const updated: Template = { ...existing, ...body, id };
                    mockDb.templates.set(id, updated);
                    responseBody = updated;
                } else if (method === "DELETE") {
                    mockDb.templates.delete(id);
                    responseBody = { success: true };
                }
            }

            return new Response(JSON.stringify(responseBody), {
                status,
                headers: { "Content-Type": "application/json" },
            });
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function unwrap<T>(data: (T | ErrorResponse) | { message: string } | undefined): T {
        if (!data) throw new Error("No response data");
        if (typeof data === "object" && !Array.isArray(data) && "message" in data && !("id" in data)) {
            throw new Error((data as { message: string }).message);
        }
        return data as T;
    }

    function createTestApiGraph() {
        const entities: Entities<OpenApiSchema> = {
            transaction: [],
            subcategory: [],
            mainCategory: [],
            expenseType: [],
            transactionType: [],
            template: [],
        };
        const api: ValidApi<OpenApiGraphDef> = {
            transaction: {
                list: async () => {
                    const res = await getTransactions({ throwOnError: true });
                    return unwrap(res.data);
                },
                read: async (id: string) => {
                    const res = await getTransaction({ path: { id }, throwOnError: true });
                    return unwrap(res.data);
                },
                create: async (data) => {
                    const res = await createTransaction({ body: data, throwOnError: true });
                    return unwrap(res.data);
                },
                update: async (data) => {
                    const res = await updateTransaction({ path: { id: data.id }, body: data, throwOnError: true });
                    return unwrap(res.data);
                },
                delete: async (id: string) => {
                    const res = await deleteTransaction({ path: { id }, throwOnError: true });
                    unwrap(res.data);
                },
            },
            subcategory: {
                list: async () => {
                    const res = await getSubcategories({ throwOnError: true });
                    return unwrap(res.data);
                },
                read: async (id: string) => {
                    const res = await getSubcategory({ path: { id }, throwOnError: true });
                    return unwrap(res.data);
                },
                create: async (data) => {
                    const res = await createSubcategory({ body: data, throwOnError: true });
                    return unwrap(res.data);
                },
                update: async (data) => {
                    const res = await updateSubcategory({ path: { id: data.id }, body: data, throwOnError: true });
                    return unwrap(res.data);
                },
                delete: async (id: string) => {
                    const res = await deleteSubcategory({ path: { id }, throwOnError: true });
                    unwrap(res.data);
                },
            },
            mainCategory: {
                list: async () => {
                    const res = await getMainCategories({ throwOnError: true });
                    return unwrap(res.data);
                },
                read: async (id: string) => {
                    const res = await getMainCategory({ path: { id }, throwOnError: true });
                    return unwrap(res.data);
                },
                create: async (data) => {
                    const res = await createMainCategory({ body: data, throwOnError: true });
                    return unwrap(res.data);
                },
                update: async (data) => {
                    const res = await updateMainCategory({ path: { id: data.id }, body: data, throwOnError: true });
                    return unwrap(res.data);
                },
                delete: async (id: string) => {
                    const res = await deleteMainCategory({ path: { id }, throwOnError: true });
                    unwrap(res.data);
                },
            },
            expenseType: {
                list: async () => {
                    const res = await getExpenseTypes({ throwOnError: true });
                    return unwrap(res.data);
                },
            },
            transactionType: {
                list: async () => {
                    const res = await getTransactionTypes({ throwOnError: true });
                    return unwrap(res.data);
                },
            },
            template: {
                list: async () => {
                    const res = await getTemplates({ throwOnError: true });
                    return unwrap(res.data);
                },
                read: async (id: string) => {
                    const res = await getTemplate({ path: { id }, throwOnError: true });
                    return unwrap(res.data);
                },
                create: async (data) => {
                    const res = await createTemplate({ body: data, throwOnError: true });
                    return unwrap(res.data);
                },
                update: async (data) => {
                    const res = await updateTemplate({ path: { id: data.id }, body: data, throwOnError: true });
                    return unwrap(res.data);
                },
                delete: async (id: string) => {
                    const res = await deleteTemplate({ path: { id }, throwOnError: true });
                    unwrap(res.data);
                },
            },
        };

        return createGraph<OpenApiGraphDef>({
            entities,
            edges: openApiEdges,
            api,
        });
    }

    it("fetches transaction list from OpenAPI backend client into graph", async () => {
        const graph = createTestApiGraph();
        expect(graph.transactionNodes().entities()).toHaveLength(0);

        const fetchedList = await graph.transactionNodes().load();
        expect(fetchedList.entities()).toHaveLength(2);
        expect(fetchedList.entities()[0].item).toBe("Coffee");
        expect(fetchedList.entities()[1].item).toBe("Book");
    });

    it("fetches expense types, transaction types, and templates into graph", async () => {
        const graph = createTestApiGraph();

        const expenseTypes = await graph.expenseTypeNodes().load();
        expect(expenseTypes.entities()).toHaveLength(1);
        expect(expenseTypes.entities()[0].name).toBe("Food & Household");

        const txTypes = await graph.transactionTypeNodes().load();
        expect(txTypes.entities()).toHaveLength(1);
        expect(txTypes.entities()[0].name).toBe("Expense");

        const templates = await graph.templateNodes().load();
        expect(templates.entities()).toHaveLength(1);
        expect(templates.entities()[0].name).toBe("Weekly Coffee");
    });

    it("loads single entity node via OpenAPI client read handler", async () => {
        const graph = createTestApiGraph();
        expect(graph.transaction("tx1").value()).toBeUndefined();

        await graph.transaction("tx1").load();
        expect(graph.transaction("tx1").value()).toEqual({
            id: "tx1",
            item: "Coffee",
            amount: 4.5,
            date: "2026-08-09",
            subcategoryId: "sub1",
        });
    });

    it("creates a new entity via OpenAPI client create handler and wraps in node", async () => {
        const graph = createTestApiGraph();

        const newNode = await graph.createTransaction({
            item: "Lunch",
            amount: 15.5,
            date: "2026-08-09",
            subcategoryId: "sub1",
        });

        expect(newNode.exists()).toBe(true);
        expect(newNode.value()?.item).toBe("Lunch");
        expect(mockDb.transactions.size).toBe(3);
    });

    it("creates, updates, and deletes templates via OpenAPI client handlers", async () => {
        const graph = createTestApiGraph();

        const newTpl = await graph.createTemplate({
            name: "Monthly Gym",
            itemName: "Gym Pass",
            amount: 30,
            date: null,
            subcategoryId: "sub1",
        });
        expect(newTpl.exists()).toBe(true);
        expect(newTpl.value()?.name).toBe("Monthly Gym");

        await newTpl.update((t) => ({ ...t, amount: 35 }));
        expect(newTpl.value()?.amount).toBe(35);

        await newTpl.delete();
        expect(newTpl.exists()).toBe(false);
    });

    it("updates entity via OpenAPI client update handler with transaction safety", async () => {
        const graph = createTestApiGraph();
        await graph.transaction("tx1").load();

        await graph.transaction("tx1").update((tx) => ({
            ...tx,
            amount: 6.0,
            item: "Espresso Large",
        }));

        expect(graph.transaction("tx1").value()?.amount).toBe(6.0);
        expect(graph.transaction("tx1").value()?.item).toBe("Espresso Large");
        expect(mockDb.transactions.get("tx1")?.amount).toBe(6.0);
    });

    it("deletes entity via OpenAPI client delete handler", async () => {
        const graph = createTestApiGraph();
        await graph.transaction("tx1").load();
        expect(graph.transaction("tx1").exists()).toBe(true);

        await graph.transaction("tx1").delete();
        expect(graph.transaction("tx1").exists()).toBe(false);
        expect(mockDb.transactions.has("tx1")).toBe(false);
    });

    it("traverses relationships across nodes loaded via OpenAPI backend", async () => {
        const graph = createTestApiGraph();

        await graph.transaction("tx1").load();
        await graph.subcategory("sub1").load();
        await graph.mainCategory("mc1").load();
        await graph.expenseTypeNodes().load();
        await graph.transactionTypeNodes().load();
        await graph.template("tpl1").load();

        const txNode = graph.transaction("tx1");
        const subNode = txNode.subcategory();
        const mainNode = subNode.mainCategory();
        const expNode = subNode.expenseType();
        const txTypeNode = mainNode.transactionType();
        const tplNode = graph.template("tpl1");

        expect(subNode.value()?.name).toBe("Groceries & Cafe");
        expect(mainNode.value()?.name).toBe("Daily Expenses");
        expect(expNode.value()?.name).toBe("Food & Household");
        expect(txTypeNode.value()?.name).toBe("Expense");
        expect(tplNode.subcategory().value()?.id).toBe("sub1");
    });
});
