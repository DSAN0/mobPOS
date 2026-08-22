/** @odoo-module **/

import { Component, useState, onWillStart } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { user } from "@web/core/user";
import { _t } from "@web/core/l10n/translation";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";

function emptyForm() {
    return {
        id: false,
        name: "",
        category_id: false,
        brand: "",
        model_name: "",
        purchase_price: 0,
        selling_price: 0,
        stock_quantity: 0,
        reorder_level: 5,
        warranty: "",
        image: false,
        notes: "",
        specs: [], // [{ attribute_id, attribute_name, value }]
    };
}

export class MobileShopProductsScreen extends Component {
    static template = "mobile_shop_pos.ProductsScreen";
    static props = ["*"];

    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");
        this.dialog = useService("dialog");
        this.action = useService("action");

        this.state = useState({
            categories: [{ id: null, name: "All" }],
            formCategories: [],
            specAttributes: [],
            products: [],
            activeCategory: null,
            searchTerm: "",
            loading: true,
            panelOpen: false,
            isNew: true,
            saving: false,
            form: emptyForm(),
        });

        onWillStart(async () => {
            // This screen shows cost price and lets anyone editing here change
            // prices or delete products, so it's restricted to Owner/Manager
            // even beyond the menu being hidden — opening the client action
            // directly by URL must not bypass this.
            const isManager = await user.hasGroup("mobile_shop_pos.group_mobile_shop_manager");
            if (!isManager) {
                this.notification.add(
                    _t("You don't have access to the product editor."),
                    { type: "danger" }
                );
                await this.action.doAction("mobile_shop_pos.mobile_pos_screen_action", {
                    clearBreadcrumbs: true,
                });
                return;
            }

            await this.loadCategories();
            await this.loadSpecAttributes();
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
        this.state.formCategories = categories;
    }

    async loadSpecAttributes() {
        this.state.specAttributes = await this.orm.searchRead(
            "mobile.spec.attribute",
            [],
            ["id", "name"],
            { order: "name asc" }
        );
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
                    "selling_price",
                    "stock_quantity",
                    "reorder_level",
                    "is_low_stock",
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

    formImageUrl() {
        if (this.state.form.image) {
            const src = this.state.form.image.startsWith("data:")
                ? this.state.form.image
                : `data:image/png;base64,${this.state.form.image}`;
            return src;
        }
        return "/mobile_shop_pos/static/src/img/placeholder.png";
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

    /* ---------------------------------------------------------------- */
    /* Panel / form                                                       */
    /* ---------------------------------------------------------------- */

    openNewProduct() {
        this.state.form = emptyForm();
        if (this.state.formCategories.length) {
            this.state.form.category_id = this.state.formCategories[0].id;
        }
        this.state.isNew = true;
        this.state.panelOpen = true;
    }

    async openEditProduct(product) {
        const [record] = await this.orm.read(
            "mobile.phone.product",
            [product.id],
            [
                "id",
                "name",
                "category_id",
                "brand",
                "model_name",
                "purchase_price",
                "selling_price",
                "stock_quantity",
                "reorder_level",
                "warranty",
                "image",
                "notes",
            ]
        );
        const specLines = await this.orm.searchRead(
            "mobile.product.spec",
            [["product_id", "=", product.id]],
            ["id", "attribute_id", "value"],
            { order: "sequence, id" }
        );

        this.state.form = {
            ...emptyForm(),
            ...record,
            category_id: record.category_id ? record.category_id[0] : false,
            specs: specLines.map((line) => ({
                attribute_id: line.attribute_id[0],
                attribute_name: line.attribute_id[1],
                value: line.value,
            })),
        };
        this.state.isNew = false;
        this.state.panelOpen = true;
    }

    closePanel() {
        this.state.panelOpen = false;
    }

    setFormCategory(id) {
        this.state.form.category_id = id;
    }

    onFieldInput(field, ev) {
        this.state.form[field] = ev.target.value;
    }

    onNumberInput(field, ev) {
        const val = parseFloat(ev.target.value);
        this.state.form[field] = isNaN(val) ? 0 : val;
    }

    onImageChange(ev) {
        const file = ev.target.files && ev.target.files[0];
        if (!file) {
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = reader.result.split(",")[1];
            this.state.form.image = base64;
        };
        reader.readAsDataURL(file);
    }

    removeImage() {
        this.state.form.image = false;
    }

    /* ---------------------------------------------------------------- */
    /* Specification lines                                                */
    /* ---------------------------------------------------------------- */

    addSpecLine() {
        if (!this.state.specAttributes.length) {
            this.notification.add(_t("Create a specification type first"), { type: "warning" });
            return;
        }
        this.state.form.specs.push({
            attribute_id: this.state.specAttributes[0].id,
            attribute_name: this.state.specAttributes[0].name,
            value: "",
        });
    }

    onSpecAttributeChange(specLine, ev) {
        const attrId = parseInt(ev.target.value, 10);
        const attr = this.state.specAttributes.find((a) => a.id === attrId);
        specLine.attribute_id = attrId;
        specLine.attribute_name = attr ? attr.name : "";
    }

    onSpecValueInput(specLine, ev) {
        specLine.value = ev.target.value;
    }

    removeSpecLine(specLine) {
        const idx = this.state.form.specs.indexOf(specLine);
        if (idx >= 0) {
            this.state.form.specs.splice(idx, 1);
        }
    }

    async createNewSpecType() {
        const name = window.prompt(_t("New specification name (e.g. Wattage, mAh Capacity):"));
        if (!name || !name.trim()) {
            return;
        }
        try {
            const newId = await this.orm.create("mobile.spec.attribute", [{ name: name.trim() }]);
            const id = Array.isArray(newId) ? newId[0] : newId;
            await this.loadSpecAttributes();
            this.state.form.specs.push({
                attribute_id: id,
                attribute_name: name.trim(),
                value: "",
            });
        } catch (error) {
            const message =
                (error && error.data && error.data.message) ||
                _t("Could not create this specification type.");
            this.notification.add(message, { type: "danger" });
        }
    }

    /* ---------------------------------------------------------------- */
    /* Save / delete                                                      */
    /* ---------------------------------------------------------------- */

    async saveProduct() {
        const form = this.state.form;
        if (!form.brand || !form.brand.trim() || !form.model_name || !form.model_name.trim()) {
            this.notification.add(_t("Brand and Model are required"), { type: "danger" });
            return;
        }
        if (!form.category_id) {
            this.notification.add(_t("Category is required"), { type: "danger" });
            return;
        }
        if (this.state.saving) {
            return;
        }
        this.state.saving = true;
        try {
            const specCommands = [[5, 0, 0]].concat(
                form.specs
                    .filter((s) => s.attribute_id && s.value && s.value.trim())
                    .map((s) => [0, 0, { attribute_id: s.attribute_id, value: s.value.trim() }])
            );

            const vals = {
                category_id: form.category_id,
                brand: form.brand,
                model_name: form.model_name,
                purchase_price: form.purchase_price,
                selling_price: form.selling_price,
                stock_quantity: form.stock_quantity,
                reorder_level: form.reorder_level,
                warranty: form.warranty,
                image: form.image || false,
                notes: form.notes,
                spec_ids: specCommands,
            };

            if (this.state.isNew) {
                await this.orm.create("mobile.phone.product", [vals]);
                this.notification.add(_t("Product created"), { type: "success" });
            } else {
                await this.orm.write("mobile.phone.product", [form.id], vals);
                this.notification.add(_t("Product updated"), { type: "success" });
            }
            this.state.panelOpen = false;
            await this.loadProducts();
        } catch (error) {
            const message =
                (error && error.data && error.data.message) ||
                _t("Could not save the product. Please check the values and try again.");
            this.notification.add(message, { type: "danger" });
        } finally {
            this.state.saving = false;
        }
    }

    deleteProduct() {
        const form = this.state.form;
        if (!form.id) {
            return;
        }
        this.dialog.add(ConfirmationDialog, {
            title: _t("Delete product"),
            body: _t("Delete '%s'? This cannot be undone.", form.name),
            confirmLabel: _t("Delete"),
            confirm: async () => {
                try {
                    await this.orm.unlink("mobile.phone.product", [form.id]);
                    this.notification.add(_t("Product deleted"), { type: "success" });
                    this.state.panelOpen = false;
                    await this.loadProducts();
                } catch (error) {
                    const message =
                        (error && error.data && error.data.message) ||
                        _t("Could not delete this product.");
                    this.notification.add(message, { type: "danger" });
                }
            },
            cancel: () => {},
        });
    }
}

registry.category("actions").add("mobile_shop_pos.products_screen", MobileShopProductsScreen);