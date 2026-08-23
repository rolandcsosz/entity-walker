import { describe, it, expect } from "vitest";
import { createGraph, createNonProxyGraph } from "../src/index";
import { createApiGraph } from "../src/api";
import { CustomGraph, edges } from "./types";
import { baseEntities } from "./shared";

describe("Undefined Entities Support", () => {
    describe("Proxy Graph (createGraph)", () => {
        it("allows omitting entities in config", () => {
            const graph = createGraph<CustomGraph>({ edges });

            const txNodes = graph.transactionNodes();
            expect(txNodes.isEmpty()).toBe(true);
            expect(txNodes.entities()).toEqual([]);
            expect(txNodes.length).toBe(0);

            const txNode = graph.transaction("tx1");
            expect(txNode.exists()).toBe(false);
            expect(txNode.value()).toBeUndefined();
        });

        it("allows passing entities as undefined", () => {
            const graph = createGraph<CustomGraph>({ entities: undefined, edges });

            expect(graph.transactionNodes().isEmpty()).toBe(true);
            expect(graph.subcategoryNodes().isEmpty()).toBe(true);

            expect(graph.transaction("tx1").exists()).toBe(false);
        });

        it("allows partial entities mapping (some entity keys omitted/undefined)", () => {
            const graph = createGraph<CustomGraph>({
                entities: {
                    subcategory: structuredClone(baseEntities.subcategory),
                },
                edges,
            });

            expect(graph.subcategoryNodes().length).toBe(baseEntities.subcategory.length);
            expect(graph.transactionNodes().isEmpty()).toBe(true);
            expect(graph.transactionNodes().entities()).toEqual([]);

            const subNode = graph.subcategory("sub1");
            expect(subNode.exists()).toBe(true);
            expect(subNode.transactionNodes().isEmpty()).toBe(true);
            expect(subNode.transactionNodes().entities()).toEqual([]);
        });

        it("allows explicit undefined value for entity key in entities map", () => {
            const graph = createGraph<CustomGraph>({
                entities: {
                    subcategory: structuredClone(baseEntities.subcategory),
                    transaction: undefined,
                },
                edges,
            });

            expect(graph.transactionNodes().isEmpty()).toBe(true);
            expect(graph.transactionNodes().entities()).toEqual([]);
        });

        it("supports creating new entities when entities was undefined", async () => {
            const graph = createGraph<CustomGraph>({ edges });

            const newTx = await graph.createTransaction({ subcategoryId: "sub1" });
            expect(newTx.exists()).toBe(true);
            expect(newTx.value()?.subcategoryId).toBe("sub1");

            expect(graph.transactionNodes().length).toBe(1);
            expect(graph.transactionNodes().entities().length).toBe(1);
        });
    });

    describe("Non-Proxy Graph (createNonProxyGraph)", () => {
        it("allows omitting entities in config", () => {
            const graph = createNonProxyGraph<CustomGraph>({ edges });

            const txNodes = graph.to("transactionNodes");
            expect(txNodes.isEmpty()).toBe(true);
            expect(txNodes.entities()).toEqual([]);

            const txNode = graph.to("transaction", "tx1");
            expect(txNode.exists()).toBe(false);
            expect(txNode.value()).toBeUndefined();
        });

        it("allows partial entities mapping", () => {
            const graph = createNonProxyGraph<CustomGraph>({
                entities: {
                    subcategory: structuredClone(baseEntities.subcategory),
                },
                edges,
            });

            const subNodes = graph.to("subcategoryNodes");
            expect(subNodes.length).toBe(baseEntities.subcategory.length);

            const txNodes = graph.to("transactionNodes");
            expect(txNodes.isEmpty()).toBe(true);
            expect(txNodes.entities()).toEqual([]);
        });

        it("supports create operation when entities was undefined", () => {
            const graph = createNonProxyGraph<CustomGraph>({ edges });

            const newTx = graph.create("transaction", { subcategoryId: "sub1" });
            expect(newTx.exists()).toBe(true);
            expect(graph.to("transactionNodes").length).toBe(1);
        });
    });

    describe("API-bound Graph Wrapper (createApiGraph / createGraph({ api }))", () => {
        it("allows omitting entities in API graph config", () => {
            const graph = createApiGraph<CustomGraph>({
                edges,
                api: {},
            });

            const txNodes = graph.transactionNodes();
            expect(txNodes.isEmpty()).toBe(true);
            expect(txNodes.entities()).toEqual([]);

            const txNode = graph.transaction("tx1");
            expect(txNode.exists()).toBe(false);
        });

        it("allows partial entities mapping in API graph", () => {
            const graph = createApiGraph<CustomGraph>({
                entities: {
                    subcategory: structuredClone(baseEntities.subcategory),
                },
                edges,
                api: {},
            });

            expect(graph.subcategoryNodes().length).toBe(baseEntities.subcategory.length);
            expect(graph.transactionNodes().isEmpty()).toBe(true);
        });
    });
});
