/** @odoo-module **/

import { Component, useState, onWillStart, onMounted, onWillUnmount } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { _t } from "@web/core/l10n/translation";

const QUICK_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "<"];

export class MobileShopPOSScreen extends Component {
    static template = "mobile_shop_pos.POSScreen";
    static props = ["*"];

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
        this.notification = useService("notification");

        this.quickKeys = QUICK_KEYS;

        // Kiosk look: hide messaging/activities/apps clutter from the navbar
        // while this screen is open. Removed again on unmount so the
        // Owner/Manager gets the normal Odoo UI everywhere else.
        onMounted(() => document.body.classList.add("o_mobile_shop_kiosk"));
        onWillUnmount(() => document.body.classList.remove("o_mobile_shop_kiosk"));

        this.state = useState({
            categories: [{ id: null, name: "All" }],
            products: [],
            activeCategory: null,
            searchTerm: "",
            cart: [],
            paymentMethod: "cash",
            amountTendered: 0,
            loading: true,
            processing: false,
            detailsProduct: null,
        });

        onWillStart(async () => {
            await this.loadCategories();
            await this.loadProducts();
        });
    }

    /* ---------------------------------------------------------------- */
    /* Data loading                                                      */
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
            // NOTE: purchase_price is intentionally NOT fetched here. This
            // screen is used by Cashiers too, and cost/profit data should
            // never reach their browser. The sale line's cost snapshot is
            // computed server-side at creation time instead (see sale.py).
            const products = await this.orm.searchRead(
                "mobile.phone.product",
                [["stock_quantity", ">", 0]],
                [
                    "id",
                    "name",
                    "category_id",
                    "brand",
                    "model_name",
                    "spec_summary",
                    "selling_price",
                    "stock_quantity",
                    "warranty",
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
    /* Computed helpers                                                   */
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

    cartQtyFor(productId) {
        const line = this.state.cart.find((l) => l.productId === productId);
        return line ? line.qty : 0;
    }

    get cartCount() {
        return this.state.cart.reduce((sum, l) => sum + l.qty, 0);
    }

    get total() {
        return this.state.cart.reduce((sum, l) => sum + l.qty * l.price, 0);
    }

    get changeDue() {
        return (this.state.amountTendered || 0) - this.total;
    }

    formatMoney(value) {
        return (value || 0).toLocaleString("en-LK", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    }

    /* ---------------------------------------------------------------- */
    /* Product grid actions                                              */
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

    /* ---------------------------------------------------------------- */
    /* Product details panel                                             */
    /* ---------------------------------------------------------------- */

    openDetails(product) {
        this.state.detailsProduct = product;
    }

    closeDetails() {
        this.state.detailsProduct = null;
    }

    addToCartFromDetails(product) {
        this.addToCart(product);
        this.closeDetails();
    }

    addToCart(product) {
        if (product.stock_quantity <= 0) {
            return;
        }
        const existing = this.state.cart.find((l) => l.productId === product.id);
        const currentQty = existing ? existing.qty : 0;
        if (currentQty + 1 > product.stock_quantity) {
            this.notification.add(_t("Not enough stock for %s", product.name), {
                type: "danger",
            });
            return;
        }
        if (existing) {
            existing.qty += 1;
        } else {
            this.state.cart.push({
                productId: product.id,
                name: product.name,
                subtitle: this.productSubtitle(product),
                price: product.selling_price,
                qty: 1,
                stock: product.stock_quantity,
            });
        }
        if (this.state.paymentMethod !== "cash") {
            this.state.amountTendered = this.total;
        }
    }

    /* ---------------------------------------------------------------- */
    /* Cart actions                                                       */
    /* ---------------------------------------------------------------- */

    incrementLine(line) {
        this.changeQty(line, 1);
    }

    decrementLine(line) {
        this.changeQty(line, -1);
    }

    changeQty(line, delta) {
        const product = this.state.products.find((p) => p.id === line.productId);
        const newQty = line.qty + delta;
        if (newQty <= 0) {
            this.removeLine(line);
            return;
        }
        if (product && newQty > product.stock_quantity) {
            this.notification.add(_t("Not enough stock for %s", line.name), {
                type: "danger",
            });
            return;
        }
        line.qty = newQty;
        if (this.state.paymentMethod !== "cash") {
            this.state.amountTendered = this.total;
        }
    }

    onLineQtyInput(line, ev) {
        const product = this.state.products.find((p) => p.id === line.productId);
        let qty = parseInt(ev.target.value, 10);
        if (isNaN(qty) || qty < 1) {
            qty = 1;
        }
        if (product && qty > product.stock_quantity) {
            qty = product.stock_quantity;
            this.notification.add(_t("Not enough stock for %s", line.name), {
                type: "danger",
            });
        }
        line.qty = qty;
        if (this.state.paymentMethod !== "cash") {
            this.state.amountTendered = this.total;
        }
    }

    removeLine(line) {
        const idx = this.state.cart.indexOf(line);
        if (idx >= 0) {
            this.state.cart.splice(idx, 1);
        }
        if (this.state.paymentMethod !== "cash") {
            this.state.amountTendered = this.total;
        }
    }

    clearCart() {
        this.state.cart = [];
        this.state.amountTendered = 0;
        this.state.paymentMethod = "cash";
    }

    /* ---------------------------------------------------------------- */
    /* Payment                                                            */
    /* ---------------------------------------------------------------- */

    setPaymentMethod(method) {
        this.state.paymentMethod = method;
        if (method !== "cash") {
            this.state.amountTendered = this.total;
        } else {
            this.state.amountTendered = 0;
        }
    }

    pressKey(key) {
        let current = this.state.amountTendered ? String(this.state.amountTendered) : "";
        if (key === "C") {
            current = "";
        } else if (key === "<") {
            current = current.slice(0, -1);
        } else if (key === ".") {
            if (!current.includes(".")) {
                current = current === "" ? "0." : current + ".";
            }
        } else {
            current += key;
        }
        this.state.amountTendered = current === "" ? 0 : parseFloat(current) || 0;
    }

    quickAmount(amount) {
        this.state.amountTendered = amount;
    }

    /* ---------------------------------------------------------------- */
    /* Checkout                                                           */
    /* ---------------------------------------------------------------- */

    async confirmSale() {
        if (!this.state.cart.length) {
            this.notification.add(_t("Cart is empty"), { type: "warning" });
            return;
        }
        if (
            this.state.paymentMethod === "cash" &&
            this.state.amountTendered < this.total
        ) {
            this.notification.add(
                _t("Amount tendered is less than the total due"),
                { type: "danger" }
            );
            return;
        }
        if (this.state.processing) {
            return;
        }
        this.state.processing = true;
        try {
            // cost_price is deliberately omitted here — the server snapshots
            // it from the product's current purchase_price on creation, so
            // the browser never needs to know or send it.
            const lineCommands = this.state.cart.map((l) => [
                0,
                0,
                {
                    product_id: l.productId,
                    quantity: l.qty,
                    price: l.price,
                },
            ]);
            const amountTendered =
                this.state.paymentMethod === "cash"
                    ? this.state.amountTendered
                    : this.total;

            const saleId = await this.orm.create("mobile.sale.order", [
                {
                    payment_method: this.state.paymentMethod,
                    amount_tendered: amountTendered,
                    line_ids: lineCommands,
                },
            ]);
            const id = Array.isArray(saleId) ? saleId[0] : saleId;

            await this.orm.call("mobile.sale.order", "action_confirm", [[id]]);

            this.notification.add(_t("Sale confirmed"), { type: "success" });

            await this.action.doAction("mobile_shop_pos.action_report_mobile_sale", {
                additionalContext: { active_ids: [id] },
            });

            this.clearCart();
            await this.loadProducts();
        } catch (error) {
            const message =
                (error && error.data && error.data.message) ||
                _t("Could not confirm the sale. Please try again.");
            this.notification.add(message, { type: "danger" });
        } finally {
            this.state.processing = false;
        }
    }
}

registry.category("actions").add("mobile_shop_pos.pos_screen", MobileShopPOSScreen);