declare module "sql.js/dist/sql-wasm-browser.js" { const init: (cfg?: { wasmBinary?: ArrayBuffer | Uint8Array }) => Promise<unknown>; export default init; }
declare module "*.wasm" { const data: Uint8Array; export default data; }
