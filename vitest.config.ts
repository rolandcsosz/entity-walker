export default {
    test: {
        include: ["./tests/**/*.test.ts"],
        exclude: ["**/benchmark.test.ts", "./tests/benchmark.complex.test.ts"],
    },
};
