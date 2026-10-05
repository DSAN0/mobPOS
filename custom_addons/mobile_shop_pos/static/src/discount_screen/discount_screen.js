/** @odoo-module **/

import { Component, useState, onWillStart } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { user } from "@web/core/user";
import { _t } from "@web/core/l10n/translation";
import { ensureCheckedIn } from "../utils/attendance";

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
            activeBrand: null,
            activeModel: null,
            searchTerm: "",
            onlyDiscounted: false,
            loading: true,
            panelOpen: false,
            saving: false,
            form: { id: false, name: "", selling_price: 0, discount_price: 0 },
        });

        onWillStart(async () => {
            ensureCheckedIn(this.orm);
            this.state.isManager = await user.hasGroup(
                "mobile_shop_pos.group_mobile_shop_manager"
            );
            await this.loadCategories();
            await this.loadProducts();
        });
    }

    openScreen(actionXmlId) {
        if (actionXmlId) {
            this.action.doAction(actionXmlId);
        }
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
        return Array.from(brandMap.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => a.name.localeCompare(b.name));
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
        if (this.state.onlyDiscounted) {
            list = list.filter((p) => p.has_discount);
        }
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

    toggleOnlyDiscounted() {
        this.state.onlyDiscounted = !this.state.onlyDiscounted;
    }

    /* ---------------------------------------------------------------- */
    /* Edit panel (manager only)                                          */
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
