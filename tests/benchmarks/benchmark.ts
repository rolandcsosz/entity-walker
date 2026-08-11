import fs from "fs";
import { performance } from "perf_hooks";
import { createGraph as createProxyGraph } from "../../src/core/graph";
import { createNonProxyGraph } from "../../src/core/graphNoProxy";
import { Entities } from "../../src/core/types";
import { edges, ExpenseType, IncomeType, MainCategory, Schema, Subcategory, Transaction } from "../types";

function generateDataset({
    expenseTypes,
    mainCategoriesPerExpense,
    subcategoriesPerMain,
    transactionsPerSub,
}: {
    expenseTypes: number;
    mainCategoriesPerExpense: number;
    subcategoriesPerMain: number;
    transactionsPerSub: number;
}): Entities<Schema> {
    const expenseType: ExpenseType[] = [];
    const incomeType: IncomeType[] = [];
    const mainCategory: MainCategory[] = [];
    const subcategory: Subcategory[] = [];
    const transaction: Transaction[] = [];

    for (let e = 0; e < expenseTypes; e++) {
        const etId = `et-${e}`;
        const itId = `it-${e}`;
        expenseType.push({ id: etId, description: `Expense Type ${e}` });
        incomeType.push({ id: itId, description: `Income Type ${e}` });

        for (let m = 0; m < mainCategoriesPerExpense; m++) {
            const mcId = `mc-${e}-${m}`;
            mainCategory.push({ id: mcId, name: `Main ${e}-${m}`, expenseTypeId: etId, incomeTypeId: itId });

            for (let s = 0; s < subcategoriesPerMain; s++) {
                const scId = `sc-${e}-${m}-${s}`;
                subcategory.push({ id: scId, name: `Sub ${e}-${m}-${s}`, mainCategoryId: mcId });

                for (let t = 0; t < transactionsPerSub; t++) {
                    transaction.push({ id: `tx-${e}-${m}-${s}-${t}`, subcategoryId: scId });
                }
            }
        }
    }

    return { expenseType, incomeType, mainCategory, subcategory, transaction };
}

function randIdx(len: number) { return Math.floor(Math.random() * len); }

/** Nested loop: expenseType → mainCategory → subcategory (filtered) → transactions */
function loop_filteredReverse(entities: Entities<Schema>, expenseTypeId: string, subNamePrefix: string): string[] {
    const result: string[] = [];
    for (const mc of entities.mainCategory) {
        if (mc.expenseTypeId !== expenseTypeId) continue;
        for (const sc of entities.subcategory) {
            if (sc.mainCategoryId !== mc.id) continue;
            if (!sc.name.startsWith(subNamePrefix)) continue;
            for (const tx of entities.transaction) {
                if (tx.subcategoryId !== sc.id) continue;
                result.push(tx.id);
            }
        }
    }
    return result;
}

function proxyGraphQuery(graph: any, expenseTypeId: string, subNamePrefix: string): string[] {
    return graph.expenseType(expenseTypeId)
        .mainCategoryNodes()
        .subcategoryNodes((sc: any) => sc.name.startsWith(subNamePrefix))
        .transactionNodes()
        .ids();
}

function nonProxyGraphQuery(graph: any, expenseTypeId: string, subNamePrefix: string): string[] {
    return graph.to("expenseType", expenseTypeId)
        .to("mainCategoryNodes")
        .to("subcategoryNodes", (sc: any) => sc.name.startsWith(subNamePrefix))
        .to("transactionNodes")
        .ids();
}

type BenchmarkResult = {
    size: number;
    loop: number;
    proxy: number;
    nonProxy: number;
};

const DATASET_SIZES = [
    { sub: 2, tx: 2 },
    { sub: 10, tx: 10 },
    { sub: 30, tx: 30 },
    { sub: 70, tx: 70 },
    { sub: 150, tx: 150 },


];

const N = 12;
const SUB_PREFIX = "Sub 0";

async function runBenchmark() {
    const results: BenchmarkResult[] = [];

    console.log("\n=== Filtered reverse (expenseType → mainCategory → subcategory[filtered] → transactions) ===");

    for (const ds of DATASET_SIZES) {
        const entities = generateDataset({
            expenseTypes: 10,
            mainCategoriesPerExpense: 10,
            subcategoriesPerMain: ds.sub,
            transactionsPerSub: ds.tx,
        });

        const queryEtIds = Array.from({ length: N }, () => entities.expenseType[randIdx(entities.expenseType.length)].id);

        // ── nested loop ──
        let loopMs = 0;
        for (let i = 0; i < N; i++) {
            const t0 = performance.now();
            loop_filteredReverse(entities, queryEtIds[i], SUB_PREFIX);
            loopMs += performance.now() - t0;
        }

        // ── proxy graph, pre-built ──
        const proxyGraph = createProxyGraph({ entities, edges });
        let proxyMs = 0;
        for (let i = 0; i < N; i++) {
            const t0 = performance.now();
            proxyGraphQuery(proxyGraph, queryEtIds[i], SUB_PREFIX);
            proxyMs += performance.now() - t0;
        }

        // ── non-proxy graph, pre-built ──
        const npGraph = createNonProxyGraph({ entities, edges });
        let npMs = 0;
        for (let i = 0; i < N; i++) {
            const t0 = performance.now();
            nonProxyGraphQuery(npGraph, queryEtIds[i], SUB_PREFIX);
            npMs += performance.now() - t0;
        }

        const row: BenchmarkResult = {
            size: entities.transaction.length,
            loop: loopMs / N,
            proxy: proxyMs / N,
            nonProxy: npMs / N,
        };
        results.push(row);
        console.log(`  tx=${row.size.toLocaleString()}  loop=${row.loop.toFixed(3)}ms  proxy=${row.proxy.toFixed(3)}ms  np=${row.nonProxy.toFixed(3)}ms`);
    }

    generatePlot(results);
}

function generatePlot(results: BenchmarkResult[]) {
    const xs = results.map(r => r.size);
    const traces = [
        { x: xs, y: results.map(r => r.loop), name: "Nested Loop", line: { color: "#f1634c", width: 3 }, mode: "lines+markers", type: "scatter" },
        { x: xs, y: results.map(r => r.proxy), name: "Proxy Graph (pre-built)", line: { color: "#37b98b", width: 3 }, mode: "lines+markers", type: "scatter" },
        { x: xs, y: results.map(r => r.nonProxy), name: "Non-Proxy Graph (pre-built)", line: { color: "#6b8cff", width: 3 }, mode: "lines+markers", type: "scatter" },
    ];

    const layout = {
        xaxis: { title: "Number of Transactions", },
        yaxis: { title: "Average runtime (ms)", tickformat: ".0s" },
        font: { size: 18 },
        legend: { orientation: "h", x: 0.5, xanchor: "center", y: 1.2 },
        margin: { l: 100, r: 40, t: 70, b: 80 },
    };

    const html = `<!DOCTYPE html>
<html>
  <head>
    <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
  </head>
  <body>
    <div id="plot" style="width:100%;"></div>
    <script>
      Plotly.newPlot('plot', ${JSON.stringify(traces)}, ${JSON.stringify(layout)});
    </script>
  </body>
</html>`;

    fs.writeFileSync("benchmark.html", html, "utf-8");
    console.log("\nPlot saved as benchmark.html");
}

runBenchmark();
