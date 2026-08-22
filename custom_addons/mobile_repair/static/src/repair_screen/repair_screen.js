/** @odoo-module **/

import { Component, useState, onWillStart, onMounted, onWillUnmount } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { user } from "@web/core/user";
import { _t } from "@web/core/l10n/translation";

const STATUS_TABS = [
    { id: null, label: "All" },
    { id: "received", label: "Received" },
    { id: "in_progress", label: "In Progress" },
    { id: "ready", label: "Ready" },
    { id: "delivered", label: "Delivered" },
    { id: "cancelled", label: "Cancelled" },
];

const STATUS_LABELS = {
    received: "Received",
    in_progress: "In Progress",
    ready: "Ready for Pickup",
    delivered: "Delivered",
    cancelled: "Cancelled",
};

function emptyForm() {
    return {
        customer_name: "",
        customer_phone: "",
        device: "",
        issue_description: "",
        cost: 0,
    };
}

export class MobileRepairScreen extends Component {
    static template = "mobile_repair.RepairScreen";
    static props = ["*"];

    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");
        this.action = useService("action");

        this.statusTabs = STATUS_TABS;
        this.statusLabels = STATUS_LABELS;

        // Same kiosk look as the Mobile Shop screens — hides messaging/
        // activity clutter while this screen is open.
        onMounted(() => document.body.classList.add("o_mobile_shop_kiosk"));
        onWillUnmount(() => document.body.classList.remove("o_mobile_shop_kiosk"));

        this.state = useState({
            repairs: [],
            loading: true,
            activeStatus: null,
            searchTerm: "",
            form: emptyForm(),
            saving: false,
            panelOpen: false,
            isManager: false,
        });

        onWillStart(async () => {
            this.state.isManager = await user.hasGroup("mobile_shop_pos.group_mobile_shop_manager");
            await this.loadRepairs();
        });
    }

    /* ---------------------------------------------------------------- */
    /* Data loading                                                       */
    /* ---------------------------------------------------------------- */

    async loadRepairs() {
        this.state.loading = true;
        try {
            const repairs = await this.orm.searchRead(
                "mobile.repair.order",
                [],
                [
                    "id",
                    "name",
                    "customer_name",
                    "customer_phone",
                    "device",
                    "issue_description",
                    "status",
                    "cost",
                    "received_date",
                    "delivered_date",
                ],
                { order: "id desc" }
            );
            this.state.repairs = repairs;
        } finally {
            this.state.loading = false;
        }
    }

    /* ---------------------------------------------------------------- */
    /* Computed helpers                                                   */
    /* ---------------------------------------------------------------- */

    get filteredRepairs() {
        let list = this.state.repairs;
        if (this.state.activeStatus !== null) {
            list = list.filter((r) => r.status === this.state.activeStatus);
        }
        const term = this.state.searchTerm.trim().toLowerCase();
        if (term) {
            list = list.filter((r) => {
                const haystack = [r.name, r.customer_name, r.customer_phone, r.device]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();
                return haystack.includes(term);
            });
        }
        return list;
    }

    formatMoney(value) {
        return (value || 0).toLocaleString("en-LK", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    }

    statusLabel(status) {
        return this.statusLabels[status] || status;
    }

    /* ---------------------------------------------------------------- */
    /* Printing                                                           */
    /* ---------------------------------------------------------------- */

    async printIntakeReceipt(repairId) {
        await this.action.doAction("mobile_repair.action_report_repair_intake", {
            additionalContext: { active_ids: [repairId] },
        });
    }

    async printDeliveryReceipt(repairId) {
        await this.action.doAction("mobile_repair.action_report_repair_delivery", {
            additionalContext: { active_ids: [repairId] },
        });
    }

    /* ---------------------------------------------------------------- */
    /* Filter / search                                                    */
    /* ---------------------------------------------------------------- */

    setStatusFilter(id) {
        this.state.activeStatus = id;
    }

    onSearchInput(ev) {
        this.state.searchTerm = ev.target.value;
    }

    clearSearch() {
        this.state.searchTerm = "";
    }

    /* ---------------------------------------------------------------- */
    /* New repair panel                                                   */
    /* ---------------------------------------------------------------- */

    openNewRepairPanel() {
        this.state.form = emptyForm();
        this.state.panelOpen = true;
    }

    closePanel() {
        this.state.panelOpen = false;
    }

    onFieldInput(field, ev) {
        this.state.form[field] = ev.target.value;
    }

    onCostInput(ev) {
        const val = parseFloat(ev.target.value);
        this.state.form.cost = isNaN(val) ? 0 : val;
    }

    async submitNewRepair() {
        const form = this.state.form;
        if (!form.customer_name.trim() || !form.customer_phone.trim()) {
            this.notification.add(_t("Customer name and phone are required"), { type: "danger" });
            return;
        }
        if (!form.device.trim()) {
            this.notification.add(_t("Device is required"), { type: "danger" });
            return;
        }
        if (!form.issue_description.trim()) {
            this.notification.add(_t("Please describe the issue"), { type: "danger" });
            return;
        }
        if (this.state.saving) {
            return;
        }
        this.state.saving = true;
        try {
            const newId = await this.orm.create("mobile.repair.order", [
                {
                    customer_name: form.customer_name.trim(),
                    customer_phone: form.customer_phone.trim(),
                    device: form.device.trim(),
                    issue_description: form.issue_description.trim(),
                    cost: form.cost,
                },
            ]);
            const id = Array.isArray(newId) ? newId[0] : newId;

            this.notification.add(_t("Repair job logged"), { type: "success" });
            this.state.panelOpen = false;
            await this.loadRepairs();
            await this.printIntakeReceipt(id);
        } catch (error) {
            const message =
                (error && error.data && error.data.message) ||
                _t("Could not log this repair. Please check the values and try again.");
            this.notification.add(message, { type: "danger" });
        } finally {
            this.state.saving = false;
        }
    }

    /* ---------------------------------------------------------------- */
    /* Status actions                                                     */
    /* ---------------------------------------------------------------- */

    async markInProgress(repair) {
        await this.orm.call("mobile.repair.order", "action_mark_in_progress", [[repair.id]]);
        await this.loadRepairs();
    }

    async markReady(repair) {
        await this.orm.call("mobile.repair.order", "action_mark_ready", [[repair.id]]);
        await this.loadRepairs();
    }

    async markDelivered(repair) {
        await this.orm.call("mobile.repair.order", "action_mark_delivered", [[repair.id]]);
        await this.loadRepairs();
        await this.printDeliveryReceipt(repair.id);
    }

    async cancelRepair(repair) {
        try {
            await this.orm.call("mobile.repair.order", "action_cancel", [[repair.id]]);
            await this.loadRepairs();
        } catch (error) {
            const message =
                (error && error.data && error.data.message) ||
                _t("Could not cancel this repair job.");
            this.notification.add(message, { type: "danger" });
        }
    }
}

registry.category("actions").add("mobile_repair.repair_screen", MobileRepairScreen);