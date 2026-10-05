/** @odoo-module **/

import { Component, useState, onWillStart } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { user } from "@web/core/user";
import { _t } from "@web/core/l10n/translation";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { ensureCheckedIn } from "../utils/attendance";
import { printReceiptReport } from "../utils/print_receipt";

const DATE_FILTERS = [
    { key: "today", label: _t("Today") },
    { key: "yesterday", label: _t("Yesterday") },
    { key: "week", label: _t("This Week") },
    { key: "month", label: _t("This Month") },
    { key: "all", label: _t("All Time") },
];

const STATUS_FILTERS = [
    { key: "all", label: _t("All") },
    { key: "confirmed", label: _t("Confirmed") },
    { key: "cancelled", label: _t("Cancelled") },
];

const PAYMENT_LABELS = {
    cash: _t("Cash"),
    card: _t("Card"),
    online: _t("Online Transfer"),
};

const STATUS_LABELS = {
    draft: _t("Draft"),
    confirmed: _t("Confirmed"),
    cancelled: _t("Cancelled"),
};

function pad(n) {
    return String(n).padStart(2, "0");
}

function toDateStr(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export class MobileShopBillsScreen extends Component {
    static template = "mobile_shop_pos.BillsScreen";
    static props = ["*"];

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
        this.notification = useService("notification");
        this.dialog = useService("dialog");

        this.dateFilters = DATE_FILTERS;
        this.statusFilters = STATUS_FILTERS;

        this.state = useState({
            // Cancel is only ever attempted server-side with the manager
            // group check in sale.py's action_cancel — this flag just
            // controls whether we show the button at all.
            isManager: false,
            bills: [],
            dateFilter: "today",
            statusFilter: "all",
            searchTerm: "",
            loading: true,
            panelOpen: false,
            detail: null,
            detailLines: [],
            detailLoading: false,
            cancelling: false,
        });

        onWillStart(async () => {
            ensureCheckedIn(this.orm);
            this.state.isManager = await user.hasGroup(
                "mobile_shop_pos.group_mobile_shop_manager"
            );
            await this.loadBills();
        });
    }

    /* ---------------------------------------------------------------- */
    /* Data loading                                                      */
    /* ---------------------------------------------------------------- */

    getDateDomain() {
        const now = new Date();
        const today = toDateStr(now);

        if (this.state.dateFilter === "today") {
            return [["sale_date", "=", today]];
        }
        if (this.state.dateFilter === "yesterday") {
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            return [["sale_date", "=", toDateStr(yesterday)]];
        }
        if (this.state.dateFilter === "week") {
            const weekStart = new Date(now);
            const dow = (weekStart.getDay() + 6) % 7; // Monday = 0
            weekStart.setDate(weekStart.getDate() - dow);
            return [["sale_date", ">=", toDateStr(weekStart)]];
        }
        if (this.state.dateFilter === "month") {
            return [["sale_date", ">=", `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`]];
        }
        return [];
    }

    getStatusDomain() {
        if (this.state.statusFilter === "all") {
            return [];
        }
        return [["state", "=", this.state.statusFilter]];
    }

    async loadBills() {
        this.state.loading = true;
        try {
            const domain = [...this.getDateDomain(), ...this.getStatusDomain()];
            this.state.bills = await this.orm.searchRead(
                "mobile.sale.order",
                domain,
                [
                    "id",
                    "name",
                    "sale_date",
                    "payment_method",
                    "amount_before_discount",
                    "total_discount",
                    "total_amount",
                    "amount_tendered",
                    "change_due",
                    "cashier_id",
                    "state",
                ],
                { order: "sale_date desc, id desc" }
            );
        } finally {
            this.state.loading = false;
        }
    }

    /* ---------------------------------------------------------------- */
    /* Filtering / computed                                              */
    /* ---------------------------------------------------------------- */

    setDateFilter(key) {
        this.state.dateFilter = key;
        this.loadBills();
    }

    setStatusFilter(key) {
        this.state.statusFilter = key;
        this.loadBills();
    }

    onSearchInput(ev) {
        this.state.searchTerm = ev.target.value;
    }

    clearSearch() {
        this.state.searchTerm = "";
    }

    get filteredBills() {
        const term = this.state.searchTerm.trim().toLowerCase();
        if (!term) {
            return this.state.bills;
        }
        return this.state.bills.filter((b) => b.name.toLowerCase().includes(term));
    }

    get summary() {
        return this.filteredBills.reduce(
            (acc, b) => {
                acc.count += 1;
                if (b.state === "confirmed") {
                    acc.revenue += b.total_amount;
                    acc.discount += b.total_discount;
                }
                return acc;
            },
            { count: 0, revenue: 0, discount: 0 }
        );
    }

    paymentLabel(method) {
        return PAYMENT_LABELS[method] || method;
    }

    statusLabel(state) {
        return STATUS_LABELS[state] || state;
    }

    formatMoney(value) {
        return (value || 0).toLocaleString("en-LK", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    }

    /* ---------------------------------------------------------------- */
    /* Detail panel                                                       */
    /* ---------------------------------------------------------------- */

    async openBill(bill) {
        this.state.detail = bill;
        this.state.panelOpen = true;
        this.state.detailLoading = true;
        this.state.detailLines = [];
        try {
            this.state.detailLines = await this.orm.searchRead(
                "mobile.sale.line",
                [["sale_id", "=", bill.id]],
                ["id", "product_id", "quantity", "price", "subtotal"],
                { order: "id asc" }
            );
        } finally {
            this.state.detailLoading = false;
        }
    }

    closePanel() {
        this.state.panelOpen = false;
    }

    async printReceipt() {
        if (!this.state.detail) {
            return;
        }
        await printReceiptReport(
            "mobile_shop_pos.report_mobile_sale_document",
            this.state.detail.id
        );
    }

    cancelBill() {
        const detail = this.state.detail;
        if (!detail) {
            return;
        }
        this.dialog.add(ConfirmationDialog, {
            title: _t("Cancel bill"),
            body: _t(
                "Cancel bill %s and restore stock? This cannot be undone.",
                detail.name
            ),
            confirmLabel: _t("Cancel Bill"),
            confirm: async () => {
                if (this.state.cancelling) {
                    return;
                }
                this.state.cancelling = true;
                try {
                    // Server-side (sale.py action_cancel) is the real
                    // enforcement of "managers only" — this button being
                    // hidden for Cashiers is just the UI reflection of it.
                    await this.orm.call("mobile.sale.order", "action_cancel", [[detail.id]]);
                    this.notification.add(_t("Bill cancelled"), { type: "success" });
                    detail.state = "cancelled";
                    await this.loadBills();
                } catch (error) {
                    const message =
                        (error && error.data && error.data.message) ||
                        _t("Could not cancel this bill.");
                    this.notification.add(message, { type: "danger" });
                } finally {
                    this.state.cancelling = false;
                }
            },
            cancel: () => {},
        });
    }
}

registry.category("actions").add("mobile_shop_pos.bills_screen", MobileShopBillsScreen);
