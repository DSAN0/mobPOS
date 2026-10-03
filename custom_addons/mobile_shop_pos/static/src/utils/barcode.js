/** @odoo-module **/

// Every screen that scans (POS, Add Stock, Products) already has its own
// product list loaded in memory for the grid, so matching a scanned code
// against that list avoids an extra round-trip per scan. Screens that
// need to search products NOT currently loaded (there are none today)
// would instead need a server search — this stays purely client-side.
export function findProductByBarcode(products, code) {
    const trimmed = (code || "").trim();
    if (!trimmed) {
        return null;
    }
    return products.find((p) => p.barcode && p.barcode === trimmed) || null;
}
