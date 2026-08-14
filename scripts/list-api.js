const ts = require("typescript");
const path = require("path");
const fs = require("fs");

const ARRAY_PROTOS = new Set([
    "length",
    "toString",
    "toLocaleString",
    "pop",
    "push",
    "concat",
    "join",
    "reverse",
    "shift",
    "slice",
    "sort",
    "splice",
    "unshift",
    "indexOf",
    "lastIndexOf",
    "every",
    "some",
    "forEach",
    "map",
    "filter",
    "reduce",
    "reduceRight",
    "find",
    "findIndex",
    "fill",
    "copyWithin",
    "entries",
    "keys",
    "values",
    "includes",
    "flatMap",
    "flat",
    "at",
    "toReversed",
    "toSorted",
    "toSpliced",
    "with",
]);

function run() {
    const demoPath = path.resolve(__dirname, "./temp_demo.ts");
    const demoContent = `
import {
    EntityGraph,
    EntityGraphNoProxy,
    ApiGraph,
    EntityNode,
    EntityNodeList,
    ApiNode,
    ApiNodeList,
    EntityGraphMeta,
    ApiGraphMeta,
    TransactionGraph,
    ApiTransactionGraph,
} from "../src/index";
import { CustomGraph, Transaction, Subcategory } from "../tests/types";

export type ConcreteProxyGraph = EntityGraph<CustomGraph>;
export type ConcreteNonProxyGraph = EntityGraphNoProxy<CustomGraph>;
export type ConcreteCoreTxGraph = TransactionGraph<CustomGraph>;
export type ConcreteApiGraph = ApiGraph<CustomGraph>;
export type ConcreteApiTxGraph = ApiTransactionGraph<CustomGraph>;
export type ConcreteTransactionNode = EntityNode<CustomGraph, Transaction>;
export type ConcreteSubcategoryNode = EntityNode<CustomGraph, Subcategory>;
export type ConcreteTransactionNodeList = EntityNodeList<CustomGraph, Transaction>;
export type ConcreteApiTransactionNode = ApiNode<CustomGraph, Transaction>;
export type ConcreteApiTransactionNodeList = ApiNodeList<CustomGraph, Transaction>;
export type ConcreteCoreMeta = EntityGraphMeta<CustomGraph>;
export type ConcreteApiMeta = ApiGraphMeta<CustomGraph>;
`;

    fs.writeFileSync(demoPath, demoContent, "utf-8");

    try {
        const indexPath = path.resolve(__dirname, "../src/index.ts");
        const typesPath = path.resolve(__dirname, "../tests/types.ts");

        const program = ts.createProgram([indexPath, typesPath, demoPath], {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.CommonJS,
        });
        const checker = program.getTypeChecker();
        const sourceFile = program.getSourceFile(indexPath);
        const demoFile = program.getSourceFile(demoPath);

        if (!sourceFile || !demoFile) {
            console.error("Could not load source files");
            return;
        }

        console.log("\n================================================================================");
        console.log("             Entity-Walker Concrete Signatures (CustomGraph Example)             ");
        console.log("================================================================================\n");

        console.log("📦 EXPORTED FUNCTIONS");
        console.log("--------------------------------------------------------------------------------");
        const symbol = checker.getSymbolAtLocation(sourceFile);
        if (symbol) {
            const exports = checker.getExportsOfModule(symbol);
            for (const exp of exports) {
                const name = exp.getName();
                const decl = exp.valueDeclaration || (exp.declarations && exp.declarations[0]);
                if (!decl) continue;

                const type = checker.getTypeOfSymbolAtLocation(exp, decl);
                const callSignatures = type.getCallSignatures();

                for (const sig of callSignatures) {
                    let sigStr = checker.signatureToString(
                        sig,
                        decl,
                        ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.WriteArrowType,
                    );
                    sigStr = cleanTypeString(sigStr);
                    console.log(` • ${name}${sigStr}`);
                }
            }
        }

        console.log("\n📦 INSTANTIATED CONCRETE GRAPH & NODE SIGNATURES (CustomGraph)");
        console.log("--------------------------------------------------------------------------------");

        const targets = [
            { name: "ConcreteProxyGraph", title: "EntityGraph<CustomGraph> (Proxy Core Graph)" },
            { name: "ConcreteNonProxyGraph", title: "EntityGraphNoProxy<CustomGraph> (Non-Proxy Core Graph)" },
            { name: "ConcreteCoreTxGraph", title: "TransactionGraph<CustomGraph> (Core Transaction Graph)" },
            { name: "ConcreteApiGraph", title: "ApiGraph<CustomGraph> (API-Bound Graph)" },
            { name: "ConcreteApiTxGraph", title: "ApiTransactionGraph<CustomGraph> (API Transaction Graph)" },
            {
                name: "ConcreteTransactionNode",
                title: "EntityNode<CustomGraph, Transaction> (Transaction Node & Relationships)",
            },
            {
                name: "ConcreteSubcategoryNode",
                title: "EntityNode<CustomGraph, Subcategory> (Subcategory Node & Relationships)",
            },
            {
                name: "ConcreteTransactionNodeList",
                title: "EntityNodeList<CustomGraph, Transaction> (Transaction Node List)",
                isList: true,
            },
            {
                name: "ConcreteApiTransactionNode",
                title: "ApiNode<CustomGraph, Transaction> (API Transaction Node & Relationships)",
            },
            {
                name: "ConcreteApiTransactionNodeList",
                title: "ApiNodeList<CustomGraph, Transaction> (API Transaction Node List)",
                isList: true,
            },
            { name: "ConcreteCoreMeta", title: "EntityGraphMeta<CustomGraph> (Core Graph Meta)" },
            { name: "ConcreteApiMeta", title: "ApiGraphMeta<CustomGraph> (API Graph Meta)" },
        ];

        for (const target of targets) {
            printTypeDetailsFromDemo(checker, demoFile, target.name, target.title, target.isList);
        }
    } finally {
        if (fs.existsSync(demoPath)) {
            fs.unlinkSync(demoPath);
        }
    }
}

function cleanTypeString(str) {
    return str
        .replace(/import\("[^"]+"\)\./g, "")
        .replace(/\/Users\/[^\s"]+/g, "")
        .replace(
            /Entities<\{\s*transaction:\s*Transaction;\s*subcategory:\s*Subcategory;\s*mainCategory:\s*MainCategory;\s*expenseType:\s*ExpenseType;\s*incomeType:\s*IncomeType;\s*\}>/g,
            "Entities<Schema>",
        )
        .replace(
            /\{\s*transaction:\s*Transaction;\s*subcategory:\s*Subcategory;\s*mainCategory:\s*MainCategory;\s*expenseType:\s*ExpenseType;\s*incomeType:\s*IncomeType;\s*\}\[Key\]/g,
            "Schema[Key]",
        );
}

function printTypeDetailsFromDemo(checker, demoFile, aliasName, title, isList = false) {
    let symbol = null;
    function visit(node) {
        if (ts.isTypeAliasDeclaration(node) && node.name.text === aliasName) {
            symbol = node.symbol;
        }
        ts.forEachChild(node, visit);
    }
    visit(demoFile);

    if (!symbol) return;

    const decl = symbol.declarations && symbol.declarations[0];
    if (!decl) return;

    console.log(`\n• ${title}`);

    const type = checker.getDeclaredTypeOfSymbol(symbol);
    const properties = checker.getPropertiesOfType(type);

    for (const prop of properties) {
        const propName = prop.getName();
        if (propName.startsWith("__@") || (isList && ARRAY_PROTOS.has(propName))) {
            continue;
        }

        const propType = checker.getTypeOfSymbolAtLocation(prop, decl);
        const sigs = propType.getCallSignatures();

        if (sigs.length > 0) {
            for (const sig of sigs) {
                let sigStr = checker.signatureToString(
                    sig,
                    decl,
                    ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.WriteArrowType,
                );
                sigStr = cleanTypeString(sigStr);
                console.log(`   ├─ .${propName}${sigStr}`);
            }
        } else {
            let propTypeStr = checker.typeToString(propType, decl, ts.TypeFormatFlags.NoTruncation);
            propTypeStr = cleanTypeString(propTypeStr);
            console.log(`   ├─ .${propName}: ${propTypeStr}`);
        }
    }
}

run();
