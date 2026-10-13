/** @odoo-module **/

import { Component, useState, onWillStart, onMounted, onWillUnmount, useEffect, useRef } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { user } from "@web/core/user";
import { _t } from "@web/core/l10n/translation";
import { printReceiptReport } from "@mobile_shop_pos/utils/print_receipt";
import { loadBundle } from "@web/core/assets";

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

const SALES_DATE_FILTERS = [
    { id: "today", label: "Today" },
    { id: "week", label: "This Week" },
    { id: "month", label: "This Month" },
    { id: "year", label: "This Year" },
    { id: "all", label: "All Time" },
    { id: "custom", label: "Custom Range" },
];



function emptyForm() {
    return {
        customer_name: "",
        customer_phone: "",
        device: "",
        issue_description: "",
        cost: 0,
    };
}

function extractDateObj(val) {
    if (!val) return null;
    if (val instanceof Date) return val;
    const str = String(val).trim();
    const datePart = str.split(" ")[0];
    const parts = datePart.split("-").map(Number);
    if (parts.length < 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) {
        return null;
    }
    return new Date(parts[0], parts[1] - 1, parts[2]);
}

function formatDateString(val) {
    if (!val) return "";
    const d = extractDateObj(val);
    if (!d) return String(val);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
}

export class MobileRepairScreen extends Component {
    static template = "mobile_repair.RepairScreen";
    static props = ["*"];

    parseFloat = parseFloat;

    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");
        this.action = useService("action");

        this.statusTabs = STATUS_TABS;
        this.statusLabels = STATUS_LABELS;
        this.salesDateFilters = SALES_DATE_FILTERS;

        // Chart canvas references
        this.trendCanvasRef = useRef("trendCanvas");
        this.breakdownCanvasRef = useRef("breakdownCanvas");
        this.devicesCanvasRef = useRef("devicesCanvas");

        this.trendChart = null;
        this.breakdownChart = null;
        this.devicesChart = null;

        onMounted(() => document.body.classList.add("o_mobile_shop_kiosk"));
        onWillUnmount(() => {
            document.body.classList.remove("o_mobile_shop_kiosk");
            this.destroyCharts();
        });

        this.state = useState({
            // Active view page: 'repairs' | 'sales'
            activePage: "repairs",

            repairs: [],
            loading: true,
            activeStatus: null,
            searchTerm: "",
            form: emptyForm(),
            saving: false,
            panelOpen: false,
            isManager: false,

            // Additional Cost modal (while repairing)
            costModalOpen: false,
            costModalRepair: null,
            costForm: {
                additional_cost: 0,
                reason: "",
            },

            // Deliver & Settle modal (at handover)
            deliverModalOpen: false,
            deliverModalRepair: null,
            deliverForm: {
                additional_cost: 0,
                reason: "",
            },

            // Sales & Revenue Page state
            salesDateFilter: "month",
            salesCustomFrom: "",
            salesCustomTo: "",
            salesSearchTerm: "",
        });

        onWillStart(async () => {
            try {
                await loadBundle("web.chartjs_lib");
            } catch (err) {
                console.warn("ChartJS bundle could not be preloaded:", err);
            }
            this.state.isManager = await user.hasGroup("mobile_shop_pos.group_mobile_shop_manager");
            await this.loadRepairs();
        });

        useEffect(
            () => {
                if (this.state.activePage === "sales" && !this.state.loading) {
                    // Small delay to allow the DOM canvas elements to render
                    const timer = setTimeout(() => {
                        this.renderCharts();
                    }, 50);
                    return () => clearTimeout(timer);
                } else {
                    this.destroyCharts();
                }
            },
            () => [
                this.state.activePage,
                this.state.loading,
                this.state.salesDateFilter,
                this.state.salesCustomFrom,
                this.state.salesCustomTo,
                this.state.repairs.length,
            ]
        );
    }

    /* ---------------------------------------------------------------- */
    /* Page Navigation                                                    */
    /* ---------------------------------------------------------------- */

    switchPage(page) {
        this.state.activePage = page;
    }

    async refreshAllData() {
        this.state.loading = true;
        try {
            await this.loadRepairs();
            this.notification.add(_t("Data refreshed successfully"), { type: "info" });
        } finally {
            this.state.loading = false;
        }
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
                    "additional_cost",
                    "additional_cost_reason",
                    "total_cost",
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
    /* Sales & Revenue Filter Helpers                                     */
    /* ---------------------------------------------------------------- */

    setSalesDateFilter(filterId) {
        this.state.salesDateFilter = filterId;
    }


    onSalesCustomDateChange(field, ev) {
        this.state[field] = ev.target.value;
    }

    onSalesSearchInput(ev) {
        this.state.salesSearchTerm = ev.target.value;
    }

    clearSalesSearch() {
        this.state.salesSearchTerm = "";
    }

    isDateInSalesFilter(dateVal) {
        const d = extractDateObj(dateVal);
        if (!d) return false;
        const now = new Date();
        const filter = this.state.salesDateFilter;

        if (filter === "all") return true;

        if (filter === "today") {
            return (
                d.getFullYear() === now.getFullYear() &&
                d.getMonth() === now.getMonth() &&
                d.getDate() === now.getDate()
            );
        }

        if (filter === "week") {
            const startOfWeek = new Date(now);
            const day = startOfWeek.getDay();
            const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
            startOfWeek.setDate(diff);
            startOfWeek.setHours(0, 0, 0, 0);
            return d >= startOfWeek;
        }

        if (filter === "month") {
            return (
                d.getFullYear() === now.getFullYear() &&
                d.getMonth() === now.getMonth()
            );
        }

        if (filter === "year") {
            return d.getFullYear() === now.getFullYear();
        }

        if (filter === "custom") {
            if (this.state.salesCustomFrom) {
                const fromD = extractDateObj(this.state.salesCustomFrom);
                if (fromD && d < fromD) return false;
            }
            if (this.state.salesCustomTo) {
                const toD = extractDateObj(this.state.salesCustomTo);
                if (toD) {
                    toD.setHours(23, 59, 59, 999);
                    if (d > toD) return false;
                }
            }
            return true;
        }

        return true;
    }

    /* ---------------------------------------------------------------- */
    /* Computed Getters                                                   */
    /* ---------------------------------------------------------------- */

    get activeRepairsCount() {
        return this.state.repairs.filter(
            (r) => r.status !== "delivered" && r.status !== "cancelled"
        ).length;
    }

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

    get previewCostModalTotal() {
        if (!this.state.costModalRepair) return 0;
        const base = this.state.costModalRepair.cost || 0;
        const extra = parseFloat(this.state.costForm.additional_cost) || 0;
        return base + extra;
    }

    get previewDeliverModalTotal() {
        if (!this.state.deliverModalRepair) return 0;
        const base = this.state.deliverModalRepair.cost || 0;
        const extra = parseFloat(this.state.deliverForm.additional_cost) || 0;
        return base + extra;
    }

    get salesMetrics() {
        // Filter delivered repairs by date
        const deliveredRepairs = this.state.repairs.filter(
            (r) => r.status === "delivered" && this.isDateInSalesFilter(r.delivered_date || r.received_date)
        );

        let repairBaseRevenue = 0;
        let repairExtraRevenue = 0;
        let repairRevenue = 0;

        for (const r of deliveredRepairs) {
            const base = r.cost || 0;
            const extra = r.additional_cost || 0;
            const total = r.total_cost || (base + extra);
            repairBaseRevenue += base;
            repairExtraRevenue += extra;
            repairRevenue += total;
        }

        const deliveredCount = deliveredRepairs.length;
        const avgTicket = deliveredCount > 0 ? (repairRevenue / deliveredCount) : 0;

        // Pending repairs pipeline
        const activeRepairs = this.state.repairs.filter(
            (r) => r.status !== "delivered" && r.status !== "cancelled"
        );
        let pendingPipeline = 0;
        for (const r of activeRepairs) {
            pendingPipeline += (r.total_cost || ((r.cost || 0) + (r.additional_cost || 0)));
        }

        return {
            repairRevenue,
            repairBaseRevenue,
            repairExtraRevenue,
            deliveredCount,
            avgTicket,
            pendingPipeline,
            pendingCount: activeRepairs.length,
        };
    }

    get filteredTransactions() {
        const list = [];

        for (const r of this.state.repairs) {
            if (r.status === "delivered" && this.isDateInSalesFilter(r.delivered_date || r.received_date)) {
                const dateRaw = r.delivered_date || r.received_date;
                list.push({
                    id: "rep_" + r.id,
                    recordId: r.id,
                    dateRaw: dateRaw,
                    dateFormatted: formatDateString(dateRaw),
                    ref: r.name,
                    customerName: r.customer_name || "Unknown",
                    customerPhone: r.customer_phone || "",
                    details: r.device + (r.issue_description ? ` (${r.issue_description})` : ""),
                    baseAmount: r.cost || 0,
                    extraAmount: r.additional_cost || 0,
                    extraReason: r.additional_cost_reason || "",
                    totalAmount: r.total_cost || ((r.cost || 0) + (r.additional_cost || 0)),
                });
            }
        }

        // Sort descending by date
        list.sort((a, b) => {
            const dA = extractDateObj(a.dateRaw);
            const dB = extractDateObj(b.dateRaw);
            return (dB ? dB.getTime() : 0) - (dA ? dA.getTime() : 0);
        });

        // Search term filter
        const term = this.state.salesSearchTerm.trim().toLowerCase();
        if (term) {
            return list.filter((t) => {
                const haystack = [t.ref, t.customerName, t.customerPhone, t.details]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();
                return haystack.includes(term);
            });
        }

        return list;
    }

    get chartDatasets() {
        const deliveredRepairs = this.state.repairs.filter(
            (r) => r.status === "delivered" && this.isDateInSalesFilter(r.delivered_date || r.received_date)
        );

        // Group by Date for Trend Chart
        const dateMap = {}; // { 'YYYY-MM-DD': { base: 0, extra: 0 } }

        for (const r of deliveredRepairs) {
            const d = extractDateObj(r.delivered_date || r.received_date);
            if (!d) continue;
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            if (!dateMap[key]) dateMap[key] = { base: 0, extra: 0 };
            dateMap[key].base += (r.cost || 0);
            dateMap[key].extra += (r.additional_cost || 0);
        }

        const sortedDates = Object.keys(dateMap).sort();
        const trendLabels = [];
        const trendBase = [];
        const trendExtra = [];

        for (const k of sortedDates) {
            const [y, m, d] = k.split("-").map(Number);
            const dateObj = new Date(y, m - 1, d);
            const label = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });
            trendLabels.push(label);
            trendBase.push(dateMap[k].base);
            trendExtra.push(dateMap[k].extra);
        }

        // Breakdown: base labor vs extra/parts
        const metrics = this.salesMetrics;
        const breakdownLabels = ["Service Labor (Base)", "Parts & Extra Costs"];
        const breakdownValues = [metrics.repairBaseRevenue, metrics.repairExtraRevenue];

        // Top Devices by Revenue
        const deviceMap = {};
        for (const r of deliveredRepairs) {
            const dev = (r.device || "Unspecified").trim();
            if (!deviceMap[dev]) deviceMap[dev] = 0;
            deviceMap[dev] += (r.total_cost || ((r.cost || 0) + (r.additional_cost || 0)));
        }

        const sortedDevices = Object.entries(deviceMap).sort((a, b) => b[1] - a[1]);
        const topDevices = sortedDevices.slice(0, 6);
        const deviceLabels = topDevices.map((e) => e[0]);
        const deviceValues = topDevices.map((e) => e[1]);

        return {
            trendData: {
                labels: trendLabels.length ? trendLabels : ["No Data"],
                base: trendBase.length ? trendBase : [0],
                extra: trendExtra.length ? trendExtra : [0],
            },
            breakdownData: {
                labels: breakdownLabels,
                values: breakdownValues,
            },
            devicesData: {
                labels: deviceLabels.length ? deviceLabels : ["No Repairs Yet"],
                values: deviceValues.length ? deviceValues : [0],
            },
        };
    }

    /* ---------------------------------------------------------------- */
    /* Chart Rendering                                                   */
    /* ---------------------------------------------------------------- */

    destroyCharts() {
        if (this.trendChart) {
            this.trendChart.destroy();
            this.trendChart = null;
        }
        if (this.breakdownChart) {
            this.breakdownChart.destroy();
            this.breakdownChart = null;
        }
        if (this.devicesChart) {
            this.devicesChart.destroy();
            this.devicesChart = null;
        }
    }

    renderCharts() {
        this.destroyCharts();
        const ChartClass = window.Chart || (typeof Chart !== "undefined" ? Chart : null);
        if (!ChartClass) {
            return;
        }

        const { trendData, breakdownData, devicesData } = this.chartDatasets;

        // 1. Revenue Over Time (Stacked Bar: base + extra)
        if (this.trendCanvasRef && this.trendCanvasRef.el) {
            this.trendChart = new ChartClass(this.trendCanvasRef.el, {
                type: "bar",
                data: {
                    labels: trendData.labels,
                    datasets: [
                        {
                            label: "Service Labor",
                            data: trendData.base,
                            backgroundColor: "rgba(13, 148, 136, 0.85)",
                            borderColor: "#0d9488",
                            borderWidth: 1.5,
                            borderRadius: 4,
                            stack: "repair",
                        },
                        {
                            label: "Parts & Extra Costs",
                            data: trendData.extra,
                            backgroundColor: "rgba(245, 158, 11, 0.85)",
                            borderColor: "#f59e0b",
                            borderWidth: 1.5,
                            borderRadius: 4,
                            stack: "repair",
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: "top",
                            labels: {
                                font: { family: "'Segoe UI', sans-serif", size: 12, weight: "bold" },
                                usePointStyle: true,
                                boxWidth: 8,
                            },
                        },
                        tooltip: {
                            callbacks: {
                                label: (context) => {
                                    const val = context.parsed.y || 0;
                                    return ` ${context.dataset.label}: LKR ${val.toLocaleString("en-LK", { minimumFractionDigits: 2 })}`;
                                },
                            },
                        },
                    },
                    scales: {
                        x: {
                            grid: { display: false },
                            ticks: { font: { size: 11 } },
                        },
                        y: {
                            beginAtZero: true,
                            ticks: {
                                callback: (v) => "LKR " + Number(v).toLocaleString("en-LK"),
                                font: { size: 11 },
                            },
                        },
                    },
                },
            });
        }

        // 2. Revenue Breakdown Donut Chart
        if (this.breakdownCanvasRef && this.breakdownCanvasRef.el) {
            const hasData = breakdownData.values.some((v) => v > 0);
            this.breakdownChart = new ChartClass(this.breakdownCanvasRef.el, {
                type: "doughnut",
                data: {
                    labels: hasData ? breakdownData.labels : ["No Revenue in Range"],
                    datasets: [
                        {
                            data: hasData ? breakdownData.values : [1],
                            backgroundColor: hasData
                                ? ["#0d9488", "#f59e0b"]
                                : ["#e2e8f0"],
                            borderWidth: 2,
                            hoverOffset: hasData ? 6 : 0,
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: "bottom",
                            labels: {
                                font: { family: "'Segoe UI', sans-serif", size: 11 },
                                usePointStyle: true,
                                boxWidth: 8,
                            },
                        },
                        tooltip: {
                            enabled: hasData,
                            callbacks: {
                                label: (context) => {
                                    const val = context.parsed || 0;
                                    return ` ${context.label}: LKR ${val.toLocaleString("en-LK", { minimumFractionDigits: 2 })}`;
                                },
                            },
                        },
                    },
                    cutout: "68%",
                },
            });
        }

        // 3. Top Devices Repaired Horizontal Bar Chart
        if (this.devicesCanvasRef && this.devicesCanvasRef.el) {
            this.devicesChart = new ChartClass(this.devicesCanvasRef.el, {
                type: "bar",
                data: {
                    labels: devicesData.labels,
                    datasets: [
                        {
                            label: "Revenue (LKR)",
                            data: devicesData.values,
                            backgroundColor: "rgba(14, 165, 233, 0.8)",
                            borderColor: "#0ea5e9",
                            borderWidth: 1.5,
                            borderRadius: 6,
                        },
                    ],
                },
                options: {
                    indexAxis: "y",
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (context) => {
                                    const val = context.parsed.x || 0;
                                    return ` Revenue: LKR ${val.toLocaleString("en-LK", { minimumFractionDigits: 2 })}`;
                                },
                            },
                        },
                    },
                    scales: {
                        x: {
                            beginAtZero: true,
                            ticks: {
                                callback: (v) => "LKR " + Number(v).toLocaleString("en-LK"),
                                font: { size: 10 },
                            },
                        },
                        y: {
                            ticks: { font: { size: 11, weight: "bold" } },
                        },
                    },
                },
            });
        }
    }

    /* ---------------------------------------------------------------- */
    /* Printing Helpers                                                   */
    /* ---------------------------------------------------------------- */

    async printIntakeReceipt(repairId) {
        await printReceiptReport("mobile_repair.report_repair_intake_document", repairId);
    }

    async printDeliveryReceipt(repairId) {
        await printReceiptReport("mobile_repair.report_repair_delivery_document", repairId);
    }



    /* ---------------------------------------------------------------- */
    /* UI Helpers                                                         */
    /* ---------------------------------------------------------------- */

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
    /* Filter / search (Repair Jobs)                                      */
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

    /* ---------------------------------------------------------------- */
    /* Additional Cost Management (While doing repair / anytime)         */
    /* ---------------------------------------------------------------- */

    openAddCostModal(repair) {
        this.state.costModalRepair = repair;
        this.state.costForm = {
            additional_cost: repair.additional_cost || 0,
            reason: repair.additional_cost_reason || "",
        };
        this.state.costModalOpen = true;
    }

    closeCostModal() {
        this.state.costModalOpen = false;
        this.state.costModalRepair = null;
    }

    onCostFormInput(field, ev) {
        if (field === "additional_cost") {
            const val = parseFloat(ev.target.value);
            this.state.costForm.additional_cost = isNaN(val) ? 0 : val;
        } else {
            this.state.costForm[field] = ev.target.value;
        }
    }

    async saveAdditionalCost() {
        if (!this.state.costModalRepair) {
            return;
        }
        if (this.state.saving) {
            return;
        }
        const repairId = this.state.costModalRepair.id;
        const addCost = parseFloat(this.state.costForm.additional_cost) || 0;
        const reason = (this.state.costForm.reason || "").trim();

        this.state.saving = true;
        try {
            await this.orm.call("mobile.repair.order", "action_update_additional_cost", [
                [repairId],
                addCost,
                reason,
            ]);
            this.notification.add(_t("Additional cost updated successfully"), { type: "success" });
            this.closeCostModal();
            await this.loadRepairs();
        } catch (error) {
            const message =
                (error && error.data && error.data.message) ||
                _t("Could not update additional cost.");
            this.notification.add(message, { type: "danger" });
        } finally {
            this.state.saving = false;
        }
    }

    /* ---------------------------------------------------------------- */
    /* Deliver & Settle Flow (When handing over / delivering device)     */
    /* ---------------------------------------------------------------- */

    openDeliverModal(repair) {
        this.state.deliverModalRepair = repair;
        this.state.deliverForm = {
            additional_cost: repair.additional_cost || 0,
            reason: repair.additional_cost_reason || "",
        };
        this.state.deliverModalOpen = true;
    }

    closeDeliverModal() {
        this.state.deliverModalOpen = false;
        this.state.deliverModalRepair = null;
    }

    onDeliverFormInput(field, ev) {
        if (field === "additional_cost") {
            const val = parseFloat(ev.target.value);
            this.state.deliverForm.additional_cost = isNaN(val) ? 0 : val;
        } else {
            this.state.deliverForm[field] = ev.target.value;
        }
    }

    async confirmDeliver() {
        if (!this.state.deliverModalRepair) {
            return;
        }
        if (this.state.saving) {
            return;
        }
        const repairId = this.state.deliverModalRepair.id;
        const addCost = parseFloat(this.state.deliverForm.additional_cost) || 0;
        const reason = (this.state.deliverForm.reason || "").trim();

        this.state.saving = true;
        try {
            await this.orm.call("mobile.repair.order", "action_mark_delivered", [
                [repairId],
                addCost,
                reason,
            ]);
            this.notification.add(_t("Repair marked as delivered"), { type: "success" });
            this.closeDeliverModal();
            await this.loadRepairs();
            await this.printDeliveryReceipt(repairId);
        } catch (error) {
            const message =
                (error && error.data && error.data.message) ||
                _t("Could not complete delivery.");
            this.notification.add(message, { type: "danger" });
        } finally {
            this.state.saving = false;
        }
    }
}

registry.category("actions").add("mobile_repair.repair_screen", MobileRepairScreen);