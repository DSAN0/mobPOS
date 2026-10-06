/** @odoo-module **/

import { Component, useState, onWillStart, onMounted, onWillUnmount, useRef } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { user } from "@web/core/user";
import { _t } from "@web/core/l10n/translation";
import { ensureCheckedIn, checkOutAndLogout } from "../utils/attendance";
import { findProductByBarcode } from "../utils/barcode";
import { printReceiptReport } from "../utils/print_receipt";

export class MobileShopPOSScreen extends Component {
    static template = "mobile_shop_pos.POSScreen";
    static props = ["*"];

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
        this.notification = useService("notification");

        this.userName = user.name;
        this.scanInputRef = useRef("scanInput");
        this.tenderedInputRef = useRef("tenderedInput");

        // Kiosk look: hide messaging/activities/apps clutter from the navbar
        // while this screen is open. Removed again on unmount so the
        // Owner/Manager gets the normal Odoo UI everywhere else.
        onMounted(() => {
            document.body.classList.add("o_mobile_shop_kiosk");
            // Auto-focus barcode scan input for immediate physical scanning
            this.scanInputRef.el?.focus();
            // Global keyboard shortcut: Shift → focus Tendered, Escape → focus Scan
            this._onGlobalKeydown = this._handleGlobalKeydown.bind(this);
            document.addEventListener("keydown", this._onGlobalKeydown, true);
        });
        onWillUnmount(() => {
            document.body.classList.remove("o_mobile_shop_kiosk");
            document.removeEventListener("keydown", this._onGlobalKeydown, true);
        });

        this.state = useState({
            categories: [{ id: null, name: "All" }],
            products: [],
            activeCategory: null,
            activeBrand: null,
            activeModel: null,
            searchTerm: "",
            scanTerm: "",
            cart: [],
            paymentMethod: "cash",
            amountTendered: 0,
            tenderedInputStr: "0",
            loading: true,
            processing: false,
            detailsProduct: null,
        });

        onWillStart(async () => {
            ensureCheckedIn(this.orm);
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
                    "discount_price",
                    "has_discount",
                    "discount_percent",
                    "stock_quantity",
                    "warranty",
                    "image",
                    "barcode",
                ],
                { order: "name asc" }
            );
            this.state.products = products;
        } finally {
            this.state.loading = false;
        }
    }

    openScreen(actionXmlId) {
        if (actionXmlId) {
            this.action.doAction(actionXmlId);
        }
    }

    /* ---------------------------------------------------------------- */
    /* Hierarchy: Categories, Brands, Models                             */
    /* ---------------------------------------------------------------- */

    get categoryList() {
        return this.state.categories.map((cat) => {
            const count = cat.id === null
                ? this.state.products.length
                : this.state.products.filter(p => p.category_id && p.category_id[0] === cat.id).length;
            return {
                ...cat,
                count,
                icon: this.getCategoryIcon(cat.name),
            };
        });
    }

    getCategoryIcon(name) {
        if (!name) return "fa-th-large";
        const n = name.toLowerCase();
        if (n.includes("phone") || n.includes("mobile") || n.includes("smartphone")) return "fa-mobile";
        if (n.includes("access")) return "fa-headphones";
        if (n.includes("cable") || n.includes("charger") || n.includes("wire")) return "fa-usb";
        if (n.includes("case") || n.includes("cover") || n.includes("glass")) return "fa-shield";
        if (n.includes("battery") || n.includes("power")) return "fa-bolt";
        if (n.includes("repair") || n.includes("tool") || n.includes("service")) return "fa-wrench";
        return "fa-folder-open";
    }

    get availableBrands() {
        if (this.state.activeCategory === null) {
            return [];
        }
        const inCat = this.state.products.filter(
            (p) => p.category_id && p.category_id[0] === this.state.activeCategory
        );
        const brandMap = new Map();
        for (const p of inCat) {
            const b = (p.brand || "").trim();
            if (b) {
                brandMap.set(b, (brandMap.get(b) || 0) + 1);
            }
        }
        const list = Array.from(brandMap.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => a.name.localeCompare(b.name));
        return list;
    }

    get availableModels() {
        if (!this.state.activeBrand) {
            return [];
        }
        let list = this.state.products;
        if (this.state.activeCategory !== null) {
            list = list.filter(
                (p) => p.category_id && p.category_id[0] === this.state.activeCategory
            );
        }
        list = list.filter((p) => (p.brand || "").trim().toLowerCase() === this.state.activeBrand.toLowerCase());

        const modelMap = new Map();
        for (const p of list) {
            const m = (p.model_name || "").trim();
            if (m) {
                modelMap.set(m, (modelMap.get(m) || 0) + 1);
            }
        }
        return Array.from(modelMap.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    get activeCategoryName() {
        if (this.state.activeCategory === null) return "All";
        const cat = this.state.categories.find(c => c.id === this.state.activeCategory);
        return cat ? cat.name : "Category";
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
        if (this.state.activeBrand !== null) {
            list = list.filter(
                (p) => (p.brand || "").trim().toLowerCase() === this.state.activeBrand.toLowerCase()
            );
        }
        if (this.state.activeModel !== null) {
            list = list.filter(
                (p) => (p.model_name || "").trim().toLowerCase() === this.state.activeModel.toLowerCase()
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

    effectivePrice(product) {
        return product.has_discount ? product.discount_price : product.selling_price;
    }

    cartQtyFor(productId) {
        const line = this.state.cart.find((l) => l.productId === productId);
        return line ? line.qty : 0;
    }

    get cartCount() {
        return this.state.cart.reduce((sum, l) => sum + l.qty, 0);
    }

    get subtotalBeforeDiscount() {
        return this.state.cart.reduce((sum, l) => sum + l.qty * l.listPrice, 0);
    }

    get totalDiscount() {
        return this.state.cart.reduce(
            (sum, l) => sum + l.qty * (l.listPrice - l.price),
            0
        );
    }

    get total() {
        return this.state.cart.reduce((sum, l) => sum + l.qty * l.price, 0);
    }

    get changeDue() {
        if (this.state.paymentMethod !== "cash") {
            return 0;
        }
        const tendered = parseFloat(this.state.amountTendered) || 0;
        return tendered - this.total;
    }

    formatMoney(value) {
        return (value || 0).toLocaleString("en-LK", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    }

    /* ---------------------------------------------------------------- */
    /* Hierarchy Selection Actions                                       */
    /* ---------------------------------------------------------------- */

    setCategory(id) {
        this.state.activeCategory = id;
        this.state.activeBrand = null;
        this.state.activeModel = null;
    }

    setBrand(brandName) {
        if (this.state.activeBrand === brandName) {
            this.state.activeBrand = null;
            this.state.activeModel = null;
        } else {
            this.state.activeBrand = brandName;
            this.state.activeModel = null;
        }
    }

    setModel(modelName) {
        if (this.state.activeModel === modelName) {
            this.state.activeModel = null;
        } else {
            this.state.activeModel = modelName;
        }
    }

    clearBrand() {
        this.state.activeBrand = null;
        this.state.activeModel = null;
    }

    clearModel() {
        this.state.activeModel = null;
    }

    resetAllFilters() {
        this.state.activeCategory = null;
        this.state.activeBrand = null;
        this.state.activeModel = null;
        this.state.searchTerm = "";
    }

    onSearchInput(ev) {
        this.state.searchTerm = ev.target.value;
    }

    clearSearch() {
        this.state.searchTerm = "";
    }

    /* ---------------------------------------------------------------- */
    /* Barcode scanning                                                   */
    /* ---------------------------------------------------------------- */

    onScanInput(ev) {
        this.state.scanTerm = ev.target.value;
    }

    onScanKeydown(ev) {
        if (ev.key === "Shift") {
            // Shift in scan input → jump to tendered
            ev.preventDefault();
            this._focusTendered();
            return;
        }
        if (ev.key !== "Enter") {
            return;
        }
        ev.preventDefault();
        const code = this.state.scanTerm;
        this.state.scanTerm = "";
        const product = findProductByBarcode(this.state.products, code);
        if (!product) {
            this.notification.add(_t("No in-stock product matches that barcode"), { type: "warning" });
            return;
        }
        this.addToCart(product);
    }

    onTenderedKeydown(ev) {
        if (ev.key === "Enter") {
            ev.preventDefault();
            this.confirmSale();
        } else if (ev.key === "Escape") {
            ev.preventDefault();
            this._focusScan();
        }
    }

    /* ---------------------------------------------------------------- */
    /* Keyboard navigation helpers                                        */
    /* ---------------------------------------------------------------- */

    _focusTendered() {
        const el = this.tenderedInputRef.el;
        if (!el || el.disabled) return;
        el.focus();
        el.select();
    }

    _focusScan() {
        this.scanInputRef.el?.focus();
    }

    _handleGlobalKeydown(ev) {
        // Don't steal keys while user is typing inside a qty / search / other input
        const tag = document.activeElement?.tagName?.toLowerCase();
        const isTypingInInput = (tag === "input" || tag === "textarea") &&
            document.activeElement !== this.scanInputRef.el &&
            document.activeElement !== this.tenderedInputRef.el;
        if (isTypingInInput) return;

        // Also skip if a modifier (Ctrl/Alt/Meta) is held — system shortcuts
        if (ev.ctrlKey || ev.altKey || ev.metaKey) return;

        switch (ev.key) {

            // ── Shift ── → focus Tendered field
            case "Shift":
                if (document.activeElement !== this.tenderedInputRef.el) {
                    ev.preventDefault();
                    this._focusTendered();
                }
                break;

            // ── Escape ── → back to scan
            case "Escape":
                ev.preventDefault();
                this._focusScan();
                break;

            // ── + or = ── → increment last cart item
            case "+":
            case "=": {
                if (!this.state.cart.length) break;
                ev.preventDefault();
                const lastLine = this.state.cart[this.state.cart.length - 1];
                this.incrementLine(lastLine);
                break;
            }

            // ── - ── → decrement last cart item
            case "-": {
                if (!this.state.cart.length) break;
                ev.preventDefault();
                const lastLine = this.state.cart[this.state.cart.length - 1];
                this.decrementLine(lastLine);
                break;
            }

            // ── E ── → Exact tendered (cash only)
            case "e":
            case "E":
                if (this.state.paymentMethod === "cash" && this.state.cart.length) {
                    ev.preventDefault();
                    this.setExactTendered();
                }
                break;

            // ── C ── → Card payment
            case "c":
            case "C":
                ev.preventDefault();
                this.setPaymentMethod("card");
                break;

            // ── O ── → Online payment
            case "o":
            case "O":
                ev.preventDefault();
                this.setPaymentMethod("online");
                break;

            default:
                break;
        }
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
                listPrice: product.selling_price,
                price: this.effectivePrice(product),
                hasDiscount: product.has_discount,
                discountPercent: product.has_discount ? product.discount_percent : 0,
                qty: 1,
                stock: product.stock_quantity,
                image: product.image,
            });
        }
        if (this.state.paymentMethod !== "cash") {
            this.state.amountTendered = this.total;
            this.state.tenderedInputStr = String(this.total);
        }
        this.scanInputRef.el?.focus();
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
            this.state.tenderedInputStr = String(this.total);
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
            this.state.tenderedInputStr = String(this.total);
        }
    }

    removeLine(line) {
        const idx = this.state.cart.indexOf(line);
        if (idx >= 0) {
            this.state.cart.splice(idx, 1);
        }
        if (this.state.paymentMethod !== "cash") {
            this.state.amountTendered = this.total;
            this.state.tenderedInputStr = String(this.total);
        }
    }

    clearCart() {
        this.state.cart = [];
        this.state.amountTendered = 0;
        this.state.tenderedInputStr = "0";
        this.state.paymentMethod = "cash";
    }

    /* ---------------------------------------------------------------- */
    /* Payment & Tendered Input                                          */
    /* ---------------------------------------------------------------- */

    setPaymentMethod(method) {
        this.state.paymentMethod = method;
        if (method !== "cash") {
            this.state.amountTendered = this.total;
            this.state.tenderedInputStr = String(this.total);
        } else {
            this.state.amountTendered = 0;
            this.state.tenderedInputStr = "0";
        }
    }

    onTenderedInput(ev) {
        const val = ev.target.value;
        this.state.tenderedInputStr = val;
        const num = parseFloat(val);
        this.state.amountTendered = isNaN(num) ? 0 : num;
    }

    onTenderedFocus(ev) {
        if (this.state.tenderedInputStr === "0") {
            this.state.tenderedInputStr = "";
        }
        ev.target.select();
    }

    onTenderedBlur(ev) {
        if (this.state.tenderedInputStr === "" || isNaN(parseFloat(this.state.tenderedInputStr))) {
            this.state.amountTendered = 0;
            this.state.tenderedInputStr = "0";
        }
    }

    setExactTendered() {
        this.state.amountTendered = this.total;
        this.state.tenderedInputStr = String(this.total);
    }

    /* ---------------------------------------------------------------- */
    /* Session                                                            */
    /* ---------------------------------------------------------------- */

    async logOut() {
        await checkOutAndLogout(this.orm);
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

            await printReceiptReport("mobile_shop_pos.report_mobile_sale_document", id);

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
