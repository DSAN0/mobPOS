/** @odoo-module **/

import { Component, useState, onWillStart } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { user } from "@web/core/user";
import { _t } from "@web/core/l10n/translation";
import { ensureCheckedIn } from "../utils/attendance";

const DATE_FILTERS = [
    { key: "today", label: _t("Today") },
    { key: "month", label: _t("This Month") },
    { key: "year", label: _t("This Year") },
    { key: "all", label: _t("All Time") },
];

const SORT_MODES = [
    { key: "profit_desc", label: _t("Most Profitable") },
    { key: "qty_desc", label: _t("Best Sellers") },
    { key: "qty_asc", label: _t("Low Sellers") },
];

export class MobileShopSalesReportScreen extends Component {
    static template = "mobile_shop_pos.SalesReportScreen";
    static props = ["*"];

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
        this.notification = useService("notification");

        this.dateFilters = DATE_FILTERS;
        this.sortModes = SORT_MODES;

        this.state = useState({
            categories: [{ id: null, name: "All" }],
            lines: [],
            dateFilter: "today",
            activeCategory: null,
            sortMode: "profit_desc",
            searchTerm: "",
            loading: true,
        });

        onWillStart(async () => {
            ensureCheckedIn(this.orm);
            const isManager = await user.hasGroup("mobile_shop_pos.group_mobile_shop_manager");
            if (!isManager) {
                this.notification.add(
                    _t("You don't have access to Sales Report."),
                    { type: "danger" }
                );
                await this.action.doAction("mobile_shop_pos.mobile_pos_screen_action", {
                    clearBreadcrumbs: true,
                });
                return;
            }

            await this.loadCategories();
            await this.loadLines();
        });
    }

    openScreen(actionXmlId) {
        if (actionXmlId) {
            this.action.doAction(actionXmlId);
        }
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

    getDateDomain() {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

        if (this.state.dateFilter === "today") {
            return [["sale_date", "=", today]];
        }
        if (this.state.dateFilter === "month") {
            const monthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
            return [["sale_date", ">=", monthStart]];
        }
        if (this.state.dateFilter === "year") {
            const yearStart = `${now.getFullYear()}-01-01`;
            return [["sale_date", ">=", yearStart]];
        }
        return [];
    }

    async loadLines() {
        this.state.loading = true;
        try {
            const domain = [["state", "=", "confirmed"], ...this.getDateDomain()];
            const lines = await this.orm.searchRead(
                "mobile.sale.line",
                domain,
                [
                    "id",
                    "product_id",
                    "brand",
                    "model_name",
                    "category_id",
                    "sale_date",
                    "quantity",
                    "subtotal",
                    "cost_total",
                    "profit",
                ],
                { order: "sale_date desc" }
            );
            this.state.lines = lines;
        } finally {
            this.state.loading = false;
        }
    }

    /* ---------------------------------------------------------------- */
    /* Filtering / grouping                                               */
    /* ---------------------------------------------------------------- */

    setDateFilter(key) {
        this.state.dateFilter = key;
        this.loadLines();
    }

    setCategory(id) {
        this.state.activeCategory = id;
    }

    get categoryList() {
        return this.state.categories.map((cat) => {
            const count = cat.id === null
                ? this.state.lines.length
                : this.state.lines.filter((l) => l.category_id && l.category_id[0] === cat.id).length;
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

    get activeCategoryName() {
        const cat = this.state.categories.find((c) => c.id === this.state.activeCategory);
        return cat ? cat.name : "All Categories";
    }

    setSortMode(key) {
        this.state.sortMode = key;
    }

    onSearchInput(ev) {
        this.state.searchTerm = ev.target.value;
    }

    clearSearch() {
        this.state.searchTerm = "";
    }

    get filteredLines() {
        let list = this.state.lines;
        if (this.state.activeCategory !== null) {
            list = list.filter(
                (l) => l.category_id && l.category_id[0] === this.state.activeCategory
            );
        }
        const term = this.state.searchTerm.trim().toLowerCase();
        if (term) {
            list = list.filter((l) => {
                const haystack = [l.product_id[1], l.brand, l.model_name]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();
                return haystack.includes(term);
            });
        }
        return list;
    }

    get summary() {
        return this.filteredLines.reduce(
            (acc, l) => {
                acc.quantity += l.quantity;
                acc.revenue += l.subtotal;
                acc.cost += l.cost_total;
                acc.profit += l.profit;
                return acc;
            },
            { quantity: 0, revenue: 0, cost: 0, profit: 0 }
        );
    }

    get groupedRows() {
        const map = new Map();
        for (const line of this.filteredLines) {
            const key = line.product_id[0];
            if (!map.has(key)) {
                map.set(key, {
                    productId: key,
                    name: line.product_id[1],
                    brand: line.brand,
                    model: line.model_name,
                    categoryName: line.category_id ? line.category_id[1] : "",
                    quantity: 0,
                    revenue: 0,
                    cost: 0,
                    profit: 0,
                });
            }
            const row = map.get(key);
            row.quantity += line.quantity;
            row.revenue += line.subtotal;
            row.cost += line.cost_total;
            row.profit += line.profit;
        }

        const rows = Array.from(map.values());

        if (this.state.sortMode === "profit_desc") {
            rows.sort((a, b) => b.profit - a.profit);
        } else if (this.state.sortMode === "qty_desc") {
            rows.sort((a, b) => b.quantity - a.quantity);
        } else if (this.state.sortMode === "qty_asc") {
            rows.sort((a, b) => a.quantity - b.quantity);
        }

        return rows;
    }

    formatMoney(value) {
        return (value || 0).toLocaleString("en-LK", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    }

    /* ---------------------------------------------------------------- */
    /* Deep-dive                                                          */
    /* ---------------------------------------------------------------- */

    openAdvancedReport() {
        this.action.doAction("mobile_shop_pos.mobile_sale_report_action");
    }
}

registry.category("actions").add("mobile_shop_pos.sales_report_screen", MobileShopSalesReportScreen);