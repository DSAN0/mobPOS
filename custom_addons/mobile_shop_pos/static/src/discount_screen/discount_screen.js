/** @odoo-module **/

import { Component, useState, onWillStart } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { user } from "@web/core/user";
import { _t } from "@web/core/l10n/translation";

export class MobileShopDiscountScreen extends Component {
    static template = "mobile_shop_pos.DiscountScreen";
    static props = ["*"];

    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");

        this.state = useState({
            isManager: false,
            categories: [{ id: null, name: "All" }],
            products: [],
            activeCategory: null,
            searchTerm: "",
            onlyDiscounted: false,
            loading: true,
            panelOpen: false,
            saving: false,
            form: { id: false, name: "", selling_price: 0, discount_price: 0 },
        });

        onWillStart(async () => {
            // Reading this page is fine for Cashiers (they need to know
            // what's on sale). Writing is still enforced server-side too:
            // Cashier has perm_write=0 on mobile.phone.product in
            // ir.model.access.csv, so even a tampered client request would
            // be rejected — this flag only controls which controls we show.
            this.state.isManager = await user.hasGroup(
                "mobile_shop_pos.group_mobile_shop_manager"
            );
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
                [],
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
        if (this.state.onlyDiscounted) {
            list = list.filter((p) => p.has_discount);
        }
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

    formatMoney(value) {
        return (value || 0).toLocaleString("en-LK", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    }

    /* ---------------------------------------------------------------- */
    /* Grid actions                                                       */
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

    toggleOnlyDiscounted() {
        this.state.onlyDiscounted = !this.state.onlyDiscounted;
    }

    /* ---------------------------------------------------------------- */
    /* Edit panel (manager only — UI convenience; server ACL is the real
       enforcement) */
    /* ---------------------------------------------------------------- */

    openEdit(product) {
        if (!this.state.isManager) {
            return;
        }
        this.state.form = {
            id: product.id,
            name: product.name,
            selling_price: product.selling_price,
            discount_price: product.discount_price || 0,
        };
        this.state.panelOpen = true;
    }

    closePanel() {
        this.state.panelOpen = false;
    }

    onDiscountPriceInput(ev) {
        const val = parseFloat(ev.target.value);
        this.state.form.discount_price = isNaN(val) ? 0 : val;
    }

    get previewPercent() {
        const { selling_price, discount_price } = this.state.form;
        if (discount_price > 0 && selling_price > 0 && discount_price < selling_price) {
            return ((selling_price - discount_price) / selling_price) * 100;
        }
        return 0;
    }

    async saveDiscount() {
        const form = this.state.form;
        if (form.discount_price < 0) {
            this.notification.add(_t("Discount price can't be negative"), {
                type: "danger",
            });
            return;
        }
        if (form.discount_price > 0 && form.discount_price >= form.selling_price) {
            this.notification.add(
                _t("Discount price must be lower than the normal price"),
                { type: "danger" }
            );
            return;
        }
        if (this.state.saving) {
            return;
        }
        this.state.saving = true;
        try {
            await this.orm.write("mobile.phone.product", [form.id], {
                discount_price: form.discount_price,
            });
            this.notification.add(_t("Discount saved"), { type: "success" });
            this.state.panelOpen = false;
            await this.loadProducts();
        } catch (error) {
            const message =
                (error && error.data && error.data.message) ||
                _t("Could not save this discount.");
            this.notification.add(message, { type: "danger" });
        } finally {
            this.state.saving = false;
        }
    }

    async clearDiscount() {
        this.state.form.discount_price = 0;
        await this.saveDiscount();
    }
}

registry.category("actions").add("mobile_shop_pos.discount_screen", MobileShopDiscountScreen);
