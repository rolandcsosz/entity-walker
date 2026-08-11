import { describe, it, expect } from "vitest";
import { CustomGraph, edges, Schema, Transaction } from "../types";
import { createGraph } from "../../src/core/graph";
import { emptyNode, emptyNodeList, emptyNodeNoProxy, emptyNodeListNoProxy } from "../../src/core/helpers";

const graph = createGraph({ entities: {}, edges });

describe("Empty factory helpers", () => {
    describe("emptyNodeList()", () => {
        it("returns an empty array and behaves as EntityNodeList", () => {
            const list = emptyNodeList<CustomGraph, Transaction>();

            expect(list).toHaveLength(0);
            expect(list.entities()).toEqual([]);
            expect(list.select(() => 1)).toEqual([]);
            expect(list.ids()).toEqual([]);
            expect(list.first()).toBeUndefined();
            expect(list.findEntity(() => true)).toBeUndefined();
            expect(list.findNode(() => true)).toBeUndefined();
            expect(list.isEmpty()).toBe(true);
            expect(list.isNotEmpty()).toBe(false);

            // operations returning lists return empty lists
            expect(list.unique()).toHaveLength(0);
            expect(list.where(() => true)).toHaveLength(0);
            expect(list.whereNode(() => true)).toHaveLength(0);
            expect(list.intersect([])).toHaveLength(0);
            expect(list.scoped()).toHaveLength(0);

            // with passes itself
            expect(list.with((s: any) => s.isEmpty())).toBe(true);
        });

        it("gracefully catches traversal property accesses via proxy and returns another empty list", () => {
            const list = emptyNodeList<CustomGraph, Transaction>();
            const subList = (list as any).someRandomNodes();

            // Should be a valid emptyNodeList as well
            expect(subList).toBeDefined();
            expect(subList).toHaveLength(0);
            expect(subList.isEmpty()).toBe(true);

            // deep chaining should not throw
            expect((list as any).aNodes().bNodes().cNodes().isEmpty()).toBe(true);
        });
    });

    describe("emptyNode()", () => {
        it("returns gracefully empty values for core EntityNode methods", () => {
            const node = emptyNode<CustomGraph, Transaction>();

            expect(node.value()).toBeUndefined();
            expect(() => node.valueOrThrow()).toThrow("Empty node has no value");
            expect(node.exists()).toBe(false);
            expect(node.path()).toEqual(["(empty)"]);

            const info = node.info();
            expect(info.type).toBe("unknown");
            expect(info.id).toBeNull();
            expect(info.exists).toBe(false);
            expect(info.path).toEqual([]);
            expect(info.value).toBeUndefined();

            // methods shouldn't throw
            expect(() => node.delete()).not.toThrow();
            expect(() => (node as any).deleteCascade()).not.toThrow();
            expect(() => node.update(() => ({ id: "1", subcategoryId: "1" }))).not.toThrow();
        });

        it("gracefully returns empty list when traversing an edge ending in Nodes", () => {
            const node = emptyNode<CustomGraph, Transaction>();
            const resultList = (node as any).someNodes();

            expect(resultList).toBeDefined();
            expect(resultList).toHaveLength(0);
            expect(resultList.isEmpty()).toBe(true);
        });

        it("gracefully returns another empty node when traversing a single edge", () => {
            const node = emptyNode<CustomGraph, Transaction>();
            const singleRel = (node as any).someProperty();

            expect(singleRel).toBeDefined();
            expect(singleRel.exists()).toBe(false);
            expect(singleRel.value()).toBeUndefined();

            // deep chaining should not throw
            expect((node as any).someProperty().another().yetAnother().exists()).toBe(false);
        });

        it("gracefully handles node to list mixed chaining", () => {
            const node = emptyNode<CustomGraph, Transaction>();

            // traverse property -> returns emptyNode; then propertiesNodes() -> returns emptyNodeList ...
            const result = (node as any)
                .aProperty()
                .bNodes()
                .cNodes()
                .with((self: any) => self.isEmpty());

            expect(result).toBe(true);
        });
    });
});

describe("Non-proxy empty builders", () => {
    describe("emptyNodeListNoProxy()", () => {
        it("returns an empty list and supports .to('XNodes')", () => {
            const list = emptyNodeListNoProxy<CustomGraph, Transaction>();

            expect(list).toHaveLength(0);
            expect(list.entities()).toEqual([]);
            expect(list.select(() => 1)).toEqual([]);
            expect(list.ids()).toEqual([]);
            expect(list.first()).toBeUndefined();
            expect(list.isEmpty()).toBe(true);

            // .to requires a Nodes suffix and returns another empty list
            // @ts-ignore: dynamic relation name used for test
            const sub = list.to("someRandomNodes");
            expect(sub).toBeDefined();
            expect(sub).toHaveLength(0);
            expect(sub.isEmpty()).toBe(true);
        });
    });

    describe("emptyNodeNoProxy()", () => {
        it("returns an empty node and supports .to('XNodes') and .to(prop)", () => {
            const node = emptyNodeNoProxy<CustomGraph, Transaction>();

            expect(node.value()).toBeUndefined();
            expect(() => node.valueOrThrow()).toThrow();
            expect(node.exists()).toBe(false);

            // @ts-ignore: dynamic relation name used for test
            const list = node.to("someNodes");
            expect(list).toBeDefined();
            expect(list).toHaveLength(0);

            // @ts-ignore: dynamic relation name used for test
            const chained = node.to("someProperty");
            expect(chained).toBeDefined();
            expect(chained.exists()).toBe(false);
        });
    });
});
