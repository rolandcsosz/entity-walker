import { describe, test, expect, vi } from "vitest";
import { createApiGraph } from "../../src/api/graph";
import { GraphDef } from "../../src/core/types";

type User = { id: number; name: string; companyId?: number };
type Post = { id: number; title: string; userId: number };
type Comment = { id: number; text: string; postId: number; authorId: number };
type Company = { id: number; name: string };

type TestEntityMap = {
    user: User;
    post: Post;
    comment: Comment;
    company: Company;
};

describe("Auto-Load Missing Forward-Edge References", () => {
    test("does not auto-load missing references by default (autoLoadReferences: false)", async () => {
        const userReadSpy = vi.fn().mockResolvedValue({ id: 101, name: "Alice" });

        const graph = createApiGraph<GraphDef<TestEntityMap>>({
            edges: {
                post: {
                    user: { resolve: (p: Post) => p.userId },
                },
            },
            api: {
                post: {
                    read: async (id: number) => ({ id, title: "Post 1", userId: 101 }),
                },
                user: {
                    read: userReadSpy,
                },
            },
        });

        await graph.post(1).load();
        await new Promise((r) => setTimeout(r, 50));

        expect(graph.post(1).exists()).toBe(true);
        expect(graph.user(101).exists()).toBe(false);
        expect(userReadSpy).not.toHaveBeenCalled();
    });

    test("auto-loads missing forward-edge references when autoLoadReferences: true is set at graph level", async () => {
        const userReadSpy = vi.fn().mockResolvedValue({ id: 101, name: "Alice" });

        const graph = createApiGraph<GraphDef<TestEntityMap>>({
            edges: {
                post: {
                    user: { resolve: (p: Post) => p.userId },
                },
            },
            api: {
                autoLoadReferences: true,
                post: {
                    read: async (id: number) => ({ id, title: "Post 1", userId: 101 }),
                },
                user: {
                    read: userReadSpy,
                },
            },
        });

        await graph.post(1).load();

        // Wait for queued background auto-load microtask
        await new Promise((r) => setTimeout(r, 50));

        expect(graph.post(1).exists()).toBe(true);
        expect(userReadSpy).toHaveBeenCalledWith(101, expect.anything());
        expect(graph.user(101).exists()).toBe(true);
        expect(graph.user(101).value()?.name).toBe("Alice");
    });

    test("per-edge autoLoad: true overrides graph-level autoLoadReferences: false", async () => {
        const userReadSpy = vi.fn().mockResolvedValue({ id: 101, name: "Alice" });
        const companyReadSpy = vi.fn().mockResolvedValue({ id: 501, name: "Acme Corp" });

        const graph = createApiGraph<GraphDef<TestEntityMap>>({
            edges: {
                post: {
                    user: { autoLoad: true, resolve: (p: Post) => p.userId },
                },
                user: {
                    company: { autoLoad: false, resolve: (u: User) => u.companyId },
                },
            },
            api: {
                autoLoadReferences: false,
                post: {
                    read: async (id: number) => ({ id, title: "Post 1", userId: 101 }),
                },
                user: {
                    read: userReadSpy,
                },
                company: {
                    read: companyReadSpy,
                },
            },
        });

        await graph.post(1).load();
        await new Promise((r) => setTimeout(r, 50));

        expect(graph.post(1).exists()).toBe(true);
        expect(userReadSpy).toHaveBeenCalledWith(101, expect.anything());
        expect(graph.user(101).exists()).toBe(true);
        expect(companyReadSpy).not.toHaveBeenCalled();
    });

    test("per-edge autoLoad: false overrides graph-level autoLoadReferences: true", async () => {
        const userReadSpy = vi.fn().mockResolvedValue({ id: 101, name: "Alice" });

        const graph = createApiGraph<GraphDef<TestEntityMap>>({
            edges: {
                post: {
                    user: { autoLoad: false, resolve: (p: Post) => p.userId },
                },
            },
            api: {
                autoLoadReferences: true,
                post: {
                    read: async (id: number) => ({ id, title: "Post 1", userId: 101 }),
                },
                user: {
                    read: userReadSpy,
                },
            },
        });

        await graph.post(1).load();
        await new Promise((r) => setTimeout(r, 50));

        expect(graph.post(1).exists()).toBe(true);
        expect(graph.user(101).exists()).toBe(false);
        expect(userReadSpy).not.toHaveBeenCalled();
    });

    test("does NOT auto-fetch reverse (incoming) edges", async () => {
        const postListSpy = vi.fn();

        const graph = createApiGraph<GraphDef<TestEntityMap>>({
            edges: {
                post: {
                    bidirectional: true,
                    user: { resolve: (p: Post) => p.userId },
                },
            },
            api: {
                autoLoadReferences: true,
                user: {
                    read: async (id: number) => ({ id, name: "Alice" }),
                },
                post: {
                    list: postListSpy,
                },
            },
        });

        await graph.user(101).load();
        await new Promise((r) => setTimeout(r, 50));

        expect(graph.user(101).exists()).toBe(true);
        expect(postListSpy).not.toHaveBeenCalled();
    });

    test("cascading auto-load along forward edge chain (post -> user -> company)", async () => {
        const userReadSpy = vi.fn().mockResolvedValue({ id: 101, name: "Alice", companyId: 501 });
        const companyReadSpy = vi.fn().mockResolvedValue({ id: 501, name: "Acme Corp" });

        const graph = createApiGraph<GraphDef<TestEntityMap>>({
            edges: {
                post: {
                    user: { resolve: (p: Post) => p.userId },
                },
                user: {
                    company: { resolve: (u: User) => u.companyId },
                },
            },
            api: {
                autoLoadReferences: true,
                post: {
                    read: async (id: number) => ({ id, title: "Post 1", userId: 101 }),
                },
                user: {
                    read: userReadSpy,
                },
                company: {
                    read: companyReadSpy,
                },
            },
        });

        await graph.post(1).load();
        await new Promise((r) => setTimeout(r, 100));

        expect(graph.post(1).exists()).toBe(true);
        expect(graph.user(101).exists()).toBe(true);
        expect(graph.company(501).exists()).toBe(true);
        expect(graph.company(501).value()?.name).toBe("Acme Corp");
    });

    test("toggling meta.setAutoLoadReferences() triggers auto-loading dynamically", async () => {
        const userReadSpy = vi.fn().mockResolvedValue({ id: 101, name: "Alice" });

        const graph = createApiGraph<GraphDef<TestEntityMap>>({
            edges: {
                post: {
                    user: { resolve: (p: Post) => p.userId },
                },
            },
            api: {
                autoLoadReferences: false,
                post: {
                    read: async (id: number) => ({ id, title: "Post 1", userId: 101 }),
                },
                user: {
                    read: userReadSpy,
                },
            },
        });

        await graph.post(1).load();
        await new Promise((r) => setTimeout(r, 50));
        expect(userReadSpy).not.toHaveBeenCalled();

        graph.meta.setAutoLoadReferences(true);
        expect(graph.meta.isAutoLoadReferencesEnabled()).toBe(true);

        await new Promise((r) => setTimeout(r, 50));
        expect(userReadSpy).toHaveBeenCalledWith(101, expect.anything());
        expect(graph.user(101).exists()).toBe(true);
    });

    test("prevents infinite loops when missing reference fails to fetch", async () => {
        const userReadSpy = vi.fn().mockRejectedValue(new Error("User not found 404"));

        const graph = createApiGraph<GraphDef<TestEntityMap>>({
            edges: {
                post: {
                    user: { resolve: (p: Post) => p.userId },
                },
            },
            api: {
                autoLoadReferences: true,
                post: {
                    read: async (id: number) => ({ id, title: "Post 1", userId: 999 }),
                },
                user: {
                    read: userReadSpy,
                },
            },
        });

        await graph.post(1).load();
        await new Promise((r) => setTimeout(r, 100));

        expect(userReadSpy).toHaveBeenCalledTimes(1);
    });

    test("sequences concurrent user load calls and defers auto-load to prevent duplicate calls", async () => {
        const userReadSpy = vi.fn().mockImplementation(async (id: number) => ({ id, name: "Alice" }));
        const postReadSpy = vi.fn().mockImplementation(async (id: number) => {
            await new Promise((r) => setTimeout(r, 20));
            return { id, title: `Post ${id}`, userId: 101 };
        });

        const graph = createApiGraph<GraphDef<TestEntityMap>>({
            edges: {
                post: {
                    user: { resolve: (p: Post) => p.userId },
                },
            },
            api: {
                autoLoadReferences: true,
                post: {
                    read: postReadSpy,
                },
                user: {
                    read: userReadSpy,
                },
            },
        });

        // Trigger post(1).load() and user(101).load() concurrently in sequence
        const p1 = graph.post(1).load();
        const u1 = graph.user(101).load();

        await Promise.all([p1, u1]);
        await new Promise((r) => setTimeout(r, 50));

        expect(graph.post(1).exists()).toBe(true);
        expect(graph.user(101).exists()).toBe(true);
        expect(userReadSpy).toHaveBeenCalledTimes(1);
    });

    test("processes sequential node loads one after another, resolving auto-loads after each sequence step", async () => {
        const userReadSpy = vi
            .fn()
            .mockImplementation(async (id: number) => ({ id, name: id === 101 ? "Alice" : "Bob" }));

        const graph = createApiGraph<GraphDef<TestEntityMap>>({
            edges: {
                post: {
                    user: { resolve: (p: Post) => p.userId },
                },
            },
            api: {
                autoLoadReferences: true,
                post: {
                    read: async (id: number) => ({ id, title: `Post ${id}`, userId: id === 1 ? 101 : 102 }),
                },
                user: {
                    read: userReadSpy,
                },
            },
        });

        // First step in sequence
        await graph.post(1).load();
        await new Promise((r) => setTimeout(r, 50));

        expect(graph.post(1).exists()).toBe(true);
        expect(graph.user(101).exists()).toBe(true);
        expect(userReadSpy).toHaveBeenCalledWith(101, expect.anything());

        // Second step in sequence
        await graph.post(2).load();
        await new Promise((r) => setTimeout(r, 50));

        expect(graph.post(2).exists()).toBe(true);
        expect(graph.user(102).exists()).toBe(true);
        expect(userReadSpy).toHaveBeenCalledWith(102, expect.anything());
        expect(userReadSpy).toHaveBeenCalledTimes(2);
    });

    test("defers auto-loading during sequential in-flight user operations and runs auto-load after all user loads complete", async () => {
        const userReadSpy = vi.fn().mockImplementation(async (id: number) => ({ id, name: `User ${id}` }));

        const graph = createApiGraph<GraphDef<TestEntityMap>>({
            edges: {
                post: {
                    user: { resolve: (p: Post) => p.userId },
                },
            },
            api: {
                autoLoadReferences: true,
                post: {
                    read: async (id: number) => {
                        await new Promise((r) => setTimeout(r, 20));
                        return { id, title: `Post ${id}`, userId: 100 + id };
                    },
                },
                user: {
                    read: userReadSpy,
                },
            },
        });

        // Trigger sequential user load operations without waiting for auto-load between them
        const load1 = graph.post(1).load();
        const load2 = graph.post(2).load();

        await Promise.all([load1, load2]);

        // Verify user loads finished first before auto-load ran
        expect(graph.post(1).exists()).toBe(true);
        expect(graph.post(2).exists()).toBe(true);

        // Wait for auto-load microtasks to finish after active user ops complete
        await new Promise((r) => setTimeout(r, 50));

        expect(graph.user(101).exists()).toBe(true);
        expect(graph.user(102).exists()).toBe(true);
        expect(userReadSpy).toHaveBeenCalledWith(101, expect.anything());
        expect(userReadSpy).toHaveBeenCalledWith(102, expect.anything());
    });

    test("sequential entity list loading (postNodes().load() -> userNodes().load()) prevents redundant auto-load single reads", async () => {
        const userReadSpy = vi.fn();
        const postListSpy = vi.fn().mockResolvedValue([
            { id: 1, title: "Post 1", userId: 101 },
            { id: 2, title: "Post 2", userId: 102 },
        ]);
        const userListSpy = vi.fn().mockResolvedValue([
            { id: 101, name: "Alice" },
            { id: 102, name: "Bob" },
        ]);

        const graph = createApiGraph<GraphDef<TestEntityMap>>({
            edges: {
                post: {
                    user: { resolve: (p: Post) => p.userId },
                },
            },
            api: {
                autoLoadReferences: true,
                post: {
                    list: postListSpy,
                },
                user: {
                    read: userReadSpy,
                    list: userListSpy,
                },
            },
        });

        // Load post list first in sequence
        await graph.postNodes().load();
        // Immediately load user list next in sequence
        await graph.userNodes().load();

        // Wait for auto-load scheduler to check for missing references
        await new Promise((r) => setTimeout(r, 50));

        expect(graph.postNodes().entities()).toHaveLength(2);
        expect(graph.userNodes().entities()).toHaveLength(2);
        expect(graph.user(101).exists()).toBe(true);
        expect(graph.user(102).exists()).toBe(true);
        // Single user read spy should NOT have been called because user list load populated both users
        expect(userReadSpy).not.toHaveBeenCalled();
    });

    test("sequential entity list loading with missing references auto-loads remaining gaps after list load sequence completes", async () => {
        const userReadSpy = vi.fn().mockImplementation(async (id: number) => ({ id, name: `User ${id}` }));
        const postListSpy = vi.fn().mockResolvedValue([
            { id: 1, title: "Post 1", userId: 101 },
            { id: 2, title: "Post 2", userId: 102 },
            { id: 3, title: "Post 3", userId: 103 },
        ]);
        const userListSpy = vi.fn().mockResolvedValue([
            { id: 101, name: "Alice" },
            { id: 102, name: "Bob" },
            // Note: User 103 is intentionally omitted from the list response to create a gap
        ]);

        const graph = createApiGraph<GraphDef<TestEntityMap>>({
            edges: {
                post: {
                    user: { resolve: (p: Post) => p.userId },
                },
            },
            api: {
                autoLoadReferences: true,
                post: {
                    list: postListSpy,
                },
                user: {
                    read: userReadSpy,
                    list: userListSpy,
                },
            },
        });

        // Load posts first, then users in sequence
        await graph.postNodes().load();
        await graph.userNodes().load();

        // Wait for auto-loader to resolve remaining gaps
        await new Promise((r) => setTimeout(r, 50));

        expect(graph.user(101).exists()).toBe(true);
        expect(graph.user(102).exists()).toBe(true);
        expect(graph.user(103).exists()).toBe(true);

        // Auto-loader should only fetch user 103 (the gap), skipping 101 and 102
        expect(userReadSpy).toHaveBeenCalledTimes(1);
        expect(userReadSpy).toHaveBeenCalledWith(103, expect.anything());
    });

    test("defers auto-loading during multi-entity list sequence and fetches missing references after", async () => {
        const companyReadSpy = vi.fn().mockImplementation(async (id: number) => ({ id, name: `Company ${id}` }));
        const userReadSpy = vi.fn();

        const postListSpy = vi.fn().mockResolvedValue([{ id: 1, title: "Post 1", userId: 101 }]);
        const userListSpy = vi.fn().mockResolvedValue([
            { id: 101, name: "Alice", companyId: 501 },
            { id: 102, name: "Bob", companyId: 502 },
        ]);
        const companyListSpy = vi.fn().mockResolvedValue([{ id: 501, name: "Acme Corp" }]);

        const graph = createApiGraph<GraphDef<TestEntityMap>>({
            edges: {
                post: {
                    user: { resolve: (p: Post) => p.userId },
                },
                user: {
                    company: { resolve: (u: User) => u.companyId },
                },
            },
            api: {
                autoLoadReferences: true,
                post: { list: postListSpy },
                user: { read: userReadSpy, list: userListSpy },
                company: { read: companyReadSpy, list: companyListSpy },
            },
        });

        await graph.postNodes().load();
        await graph.userNodes().load();
        await graph.companyNodes().load();

        expect(graph.post(1).exists()).toBe(true);
        expect(graph.user(101).exists()).toBe(true);
        expect(graph.user(102).exists()).toBe(true);
        expect(graph.company(501).exists()).toBe(true);
        expect(graph.company(502).exists()).toBe(false);
        expect(companyReadSpy).not.toHaveBeenCalled();
        expect(userReadSpy).not.toHaveBeenCalled();

        await new Promise((r) => setTimeout(r, 100));

        expect(graph.company(502).exists()).toBe(true);
        expect(graph.company(502).value()).toEqual({ id: 502, name: "Company 502" });
        expect(companyReadSpy).toHaveBeenCalledTimes(1);
        expect(companyReadSpy).toHaveBeenCalledWith(502, expect.anything());
        expect(userReadSpy).not.toHaveBeenCalled();
    });
});
