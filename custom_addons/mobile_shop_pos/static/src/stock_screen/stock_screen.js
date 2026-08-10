/** @odoo-module **/

import { Component, useState, onWillStart } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { _t } from "@web/core/l10n/translation";

export class MobileShopStockScreen extends Component {
    static template = "mobile_shop_pos.StockScreen";
    static props = ["*"];

    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");

        this.state = useState({
            categories: [{ id: null, name: "All" }],
            products: [],
            activeCategory: null,
            searchTerm: "",
            lines: [],
            loading: true,
            processing: false,
        });

        onWillStart(async () => {
            await this.loadCategories();
            await this.loadProducts();
        });
    }

    /* ---------------------------------------------------------------- */
    /* Data loading                                                       */
    /* ---------------------------------------------------------------- */

    async loadCategories() {
        const categories = await this.orm.searchRead(
            "mobile.product.category",
            [],
            ["id", "name"],
            { order: "name asc" }
        );
        this.state.categories = [{ id: null, name: "All" }, ...categories];
    }

    async loadProducts() {
        this.state.loading = true;
        try {
            const products = await this.orm.searchRead(
                "mobile.phone.product",
                [],
                [
                    "id",
                    "name",
                    "category_id",
                    "brand",
                    "model_name",
                    "spec_summary",
                    "purchase_price",
                    "stock_quantity",
                    "image",
                ],
                { order: "name asc" }
            );
            this.state.products = products;
        } finally {
            this.state.loading = false;
        }
    }

    /* ---------------------------------------------------------------- */
    /* Computed helpers                                                    */
    /* ---------------------------------------------------------------- */

    get filteredProducts() {
        let list = this.state.products;
        if (this.state.activeCategory !== null) {
            list = list.filter(
                (p) => p.category_id && p.category_id[0] === this.state.activeCategory
            );
        }
        const term = this.state.searchTerm.trim().toLowerCase();
        if (term) {
            list = list.filter((p) => {
                const haystack = [p.name, p.brand, p.model_name, p.spec_summary]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();
                return haystack.includes(term);
            });
        }
        return list;
    }

    productSubtitle(product) {
        return [product.brand, product.model_name, product.spec_summary]
            .filter(Boolean)
            .join(" · ");
    }

    productImageUrl(product) {
        return product.image
            ? `/web/image/mobile.phone.product/${product.id}/image`
            : "/mobile_shop_pos/static/src/img/placeholder.png";
    }

    lineQtyFor(productId) {
        const line = this.state.lines.find((l) => l.productId === productId);
        return line ? line.qty : 0;
    }

    get total() {
        return this.state.lines.reduce((sum, l) => sum + l.qty * l.costPrice, 0);
    }

    get lineCount() {
        return this.state.lines.reduce((sum, l) => sum + l.qty, 0);
    }

    formatMoney(value) {
        return (value || 0).toLocaleString("en-LK", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    }

    /* ---------------------------------------------------------------- */
    /* Grid actions                                                        */
    /* ---------------------------------------------------------------- */

    setCategory(id) {
        this.state.activeCategory = id;
    }

    onSearchInput(ev) {
        this.state.searchTerm = ev.target.value;
    }

    clearSearch() {
        this.state.searchTerm = "";
    }

    addToLines(product) {
        const existing = this.state.lines.find((l) => l.productId === product.id);
        if (existing) {
            existing.qty += 1;
        } else {
            this.state.lines.push({
                productId: product.id,
                name: product.name,
                subtitle: this.productSubtitle(product),
                costPrice: product.purchase_price || 0,
                qty: 1,
                currentStock: product.stock_quantity,
            });
        }
    }

    /* ---------------------------------------------------------------- */
    /* Line editing                                                        */
    /* ---------------------------------------------------------------- */

    incrementLine(line) {
        line.qty += 1;
    }

    decrementLine(line) {
        if (line.qty <= 1) {
            this.removeLine(line);
            return;
        }
        line.qty -= 1;
    }

    onLineQtyInput(line, ev) {
        let qty = parseInt(ev.target.value, 10);
        if (isNaN(qty) || qty < 1) {
            qty = 1;
        }
        line.qty = qty;
    }

    onLineCostInput(line, ev) {
        const val = parseFloat(ev.target.value);
        line.costPrice = isNaN(val) ? 0 : val;
    }

    removeLine(line) {
        const idx = this.state.lines.indexOf(line);
        if (idx >= 0) {
            this.state.lines.splice(idx, 1);
        }
    }

    clearLines() {
        this.state.lines = [];
    }

    /* ---------------------------------------------------------------- */
    /* Submit                                                              */
    /* ---------------------------------------------------------------- */

    async confirmStockIn() {
        if (!this.state.lines.length) {
            this.notification.add(_t("Add at least one item first"), { type: "warning" });
            return;
        }
        if (this.state.processing) {
            return;
        }
        this.state.processing = true;
        try {
            const lineCommands = this.state.lines.map((l) => [
                0,
                0,
                {
                    product_id: l.productId,
                    quantity: l.qty,
                    cost_price: l.costPrice,
                },
            ]);
            const purchaseId = await this.orm.create("mobile.purchase.order", [
                { line_ids: lineCommands },
            ]);
            const id = Array.isArray(purchaseId) ? purchaseId[0] : purchaseId;

            await this.orm.call("mobile.purchase.order", "action_receive", [[id]]);

            this.notification.add(_t("Stock added successfully"), { type: "success" });

            this.clearLines();
            await this.loadProducts();
        } catch (error) {
            const message =
                (error && error.data && error.data.message) ||
                _t("Could not add stock. Please try again.");
            this.notification.add(message, { type: "danger" });
        } finally {
            this.state.processing = false;
        }
    }
}

registry.category("actions").add("mobile_shop_pos.stock_screen", MobileShopStockScreen);