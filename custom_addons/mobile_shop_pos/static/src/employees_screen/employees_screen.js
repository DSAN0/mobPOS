/** @odoo-module **/

import { Component, useState, onWillStart } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { user } from "@web/core/user";
import { _t } from "@web/core/l10n/translation";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { ensureCheckedIn } from "../utils/attendance";

const ATT_DATE_FILTERS = [
    { key: "today", label: _t("Today") },
    { key: "yesterday", label: _t("Yesterday") },
    { key: "week", label: _t("This Week") },
    { key: "month", label: _t("This Month") },
    { key: "all", label: _t("All Time") },
];

const SALES_DATE_FILTERS = [
    { key: "today", label: _t("Today") },
    { key: "month", label: _t("This Month") },
    { key: "year", label: _t("This Year") },
    { key: "all", label: _t("All Time") },
];

function pad(n) {
    return String(n).padStart(2, "0");
}

function toDateStr(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Odoo returns Datetime fields as naive UTC strings ("YYYY-MM-DD HH:MM:SS").
// Appending "Z" is what makes JS parse it as UTC instead of local time.
function parseOdooDatetime(str) {
    if (!str) {
        return null;
    }
    return new Date(str.replace(" ", "T") + "Z");
}

function emptyEmployeeForm() {
    return {
        id: false,
        // "New login" mode (default for a brand-new employee)
        loginMode: "new", // 'new' | 'existing'
        new_name: "",
        new_login: "",
        new_password: "",
        new_password_confirm: "",
        role: "cashier", // 'cashier' | 'manager'
        // "Existing user" mode
        user_id: false,
        // Shared / edit fields
        position_id: false,
        phone: "",
        nic: "",
        join_date: toDateStr(new Date()),
        basic_salary: 0,
        notes: "",
        active: true,
    };
}

function emptyPaymentForm(employeeId) {
    return {
        employee_id: employeeId || false,
        payment_date: toDateStr(new Date()),
        for_month: "",
        amount: 0,
        notes: "",
    };
}

export class MobileShopEmployeesScreen extends Component {
    static template = "mobile_shop_pos.EmployeesScreen";
    static props = ["*"];

    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");
        this.dialog = useService("dialog");
        this.action = useService("action");

        this.attDateFilters = ATT_DATE_FILTERS;
        this.salesDateFilters = SALES_DATE_FILTERS;

        this.state = useState({
            activeTab: "employees",

            // Employees
            employees: [],
            positions: [],
            availableUsers: [],
            showArchived: false,
            empSearchTerm: "",
            empLoading: true,
            panelOpen: false,
            panelMode: "employee", // 'employee' | 'payment'
            isNewEmployee: true,
            empForm: emptyEmployeeForm(),
            empSaving: false,

            // Attendance
            attendance: [],
            attendanceLoading: false,
            attDateFilter: "today",
            attEmployeeFilter: null,

            // Salary
            payments: [],
            paymentsLoading: false,
            paymentEmployeeFilter: null,
            paymentForm: emptyPaymentForm(),
            paymentSaving: false,

            // Sales by employee
            salesRows: [],
            salesLoading: false,
            salesDateFilter: "month",
        });

        onWillStart(async () => {
            // This screen touches salary figures and every employee's
            // full sales history, so it's manager-only beyond the menu
            // being hidden too — opening the client action directly by
            // URL must not bypass this, same principle as Products.
            const isManager = await user.hasGroup("mobile_shop_pos.group_mobile_shop_manager");
            if (!isManager) {
                this.notification.add(
                    _t("You don't have access to Manage Employees."),
                    { type: "danger" }
                );
                await this.action.doAction("mobile_shop_pos.mobile_pos_screen_action", {
                    clearBreadcrumbs: true,
                });
                return;
            }

            ensureCheckedIn(this.orm);
            await this.loadPositions();
            await this.loadEmployees();
        });
    }

    openScreen(actionXmlId) {
        if (actionXmlId) {
            this.action.doAction(actionXmlId);
        }
    }

    /* ---------------------------------------------------------------- */
    /* Tabs                                                               */
    /* ---------------------------------------------------------------- */

    setTab(tab) {
        this.state.activeTab = tab;
        if (tab === "attendance") {
            this.loadAttendance();
        } else if (tab === "salary") {
            this.loadPayments();
        } else if (tab === "sales") {
            this.loadSales();
        }
    }

    formatMoney(value) {
        return (value || 0).toLocaleString("en-LK", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    }

    /* ================================================================
       EMPLOYEES TAB
       ================================================================ */

    async loadPositions() {
        this.state.positions = await this.orm.searchRead(
            "mobile.employee.position",
            [["name", "in", ["Cashier", "Owner / Manager", "Owner/Manager"]]],
            ["id", "name"],
            { order: "name asc" }
        );
    }

    async loadAvailableUsers() {
        const allUsers = await this.orm.searchRead(
            "res.users",
            [["share", "=", false]],
            ["id", "name", "login"],
            { order: "name asc" }
        );
        const usedIds = new Set(this.state.employees.map((e) => e.user_id[0]));
        this.state.availableUsers = allUsers.filter((u) => !usedIds.has(u.id));
    }

    async loadEmployees() {
        this.state.empLoading = true;
        try {
            this.state.employees = await this.orm.searchRead(
                "mobile.employee",
                [],
                [
                    "id",
                    "user_id",
                    "name",
                    "position_id",
                    "phone",
                    "nic",
                    "join_date",
                    "basic_salary",
                    "notes",
                    "active",
                ],
                { order: "name asc", context: { active_test: false } }
            );
        } finally {
            this.state.empLoading = false;
        }
    }

    get filteredEmployees() {
        let list = this.state.employees.filter((e) =>
            this.state.showArchived ? true : e.active
        );
        const term = this.state.empSearchTerm.trim().toLowerCase();
        if (term) {
            list = list.filter((e) => e.name.toLowerCase().includes(term));
        }
        return list;
    }

    onEmpSearchInput(ev) {
        this.state.empSearchTerm = ev.target.value;
    }

    toggleShowArchived() {
        this.state.showArchived = !this.state.showArchived;
    }

    /* ---- Panel: add / edit employee ---- */

    async openNewEmployee() {
        await this.loadAvailableUsers();
        this.state.empForm = emptyEmployeeForm();
        if (this.state.positions.length) {
            const defaultPos = this.state.positions.find((p) => p.name.includes("Cashier")) || this.state.positions[0];
            this.state.empForm.position_id = defaultPos.id;
        }
        this.state.isNewEmployee = true;
        this.state.panelMode = "employee";
        this.state.panelOpen = true;
    }

    openEditEmployee(emp) {
        this.state.empForm = {
            ...emptyEmployeeForm(),
            id: emp.id,
            loginMode: "existing",
            user_id: emp.user_id[0],
            user_name: emp.user_id[1],
            position_id: emp.position_id ? emp.position_id[0] : false,
            phone: emp.phone || "",
            nic: emp.nic || "",
            join_date: emp.join_date || toDateStr(new Date()),
            basic_salary: emp.basic_salary || 0,
            notes: emp.notes || "",
            active: emp.active,
        };
        this.state.isNewEmployee = false;
        this.state.panelMode = "employee";
        this.state.panelOpen = true;
    }

    closePanel() {
        this.state.panelOpen = false;
    }

    setLoginMode(mode) {
        this.state.empForm.loginMode = mode;
    }

    setRole(role) {
        this.state.empForm.role = role;
        if (this.state.positions.length) {
            const isManager = role === "manager";
            const match = this.state.positions.find((p) =>
                isManager ? p.name.includes("Manager") : p.name.includes("Cashier")
            );
            if (match) {
                this.state.empForm.position_id = match.id;
            }
        }
    }

    onEmpFieldInput(field, ev) {
        this.state.empForm[field] = ev.target.value;
    }

    onEmpNumberInput(field, ev) {
        const val = parseFloat(ev.target.value);
        this.state.empForm[field] = isNaN(val) ? 0 : val;
    }

    onEmpUserChange(ev) {
        this.state.empForm.user_id = parseInt(ev.target.value, 10) || false;
    }

    onEmpPositionChange(ev) {
        this.state.empForm.position_id = parseInt(ev.target.value, 10) || false;
    }

    async saveEmployee() {
        const form = this.state.empForm;

        if (!form.position_id) {
            this.notification.add(_t("Position is required"), { type: "danger" });
            return;
        }

        const useNewLogin = this.state.isNewEmployee && form.loginMode === "new";

        if (useNewLogin) {
            if (!form.new_name.trim()) {
                this.notification.add(_t("Employee name is required"), { type: "danger" });
                return;
            }
            if (!form.new_login.trim()) {
                this.notification.add(_t("Login / email is required"), { type: "danger" });
                return;
            }
            if (!form.new_password || form.new_password.length < 4) {
                this.notification.add(_t("Password must be at least 4 characters"), { type: "danger" });
                return;
            }
            if (form.new_password !== form.new_password_confirm) {
                this.notification.add(_t("Passwords don't match"), { type: "danger" });
                return;
            }
        } else if (this.state.isNewEmployee && !form.user_id) {
            this.notification.add(_t("Choose a login account for this employee"), { type: "danger" });
            return;
        }

        if (this.state.empSaving) {
            return;
        }
        this.state.empSaving = true;
        try {
            const employeeVals = {
                position_id: form.position_id,
                phone: form.phone,
                nic: form.nic,
                join_date: form.join_date,
                basic_salary: form.basic_salary,
                notes: form.notes,
            };

            if (useNewLogin) {
                // action_create_login is an @api.model method — called
                // with the ids-less signature (no record to act on yet).
                await this.orm.call("mobile.employee", "action_create_login", [
                    {
                        name: form.new_name.trim(),
                        login: form.new_login.trim(),
                        password: form.new_password,
                    },
                    employeeVals,
                    form.role,
                ]);
                this.notification.add(_t("Employee and login created"), { type: "success" });
            } else if (this.state.isNewEmployee) {
                employeeVals.user_id = form.user_id;
                await this.orm.create("mobile.employee", [employeeVals]);
                this.notification.add(_t("Employee added"), { type: "success" });
            } else {
                await this.orm.write("mobile.employee", [form.id], employeeVals);
                this.notification.add(_t("Employee updated"), { type: "success" });
            }
            this.state.panelOpen = false;
            await this.loadEmployees();
        } catch (error) {
            const message =
                (error && error.data && error.data.message) ||
                _t("Could not save this employee.");
            this.notification.add(message, { type: "danger" });
        } finally {
            this.state.empSaving = false;
        }
    }

    archiveEmployee() {
        const form = this.state.empForm;
        if (!form.id) {
            return;
        }
        this.dialog.add(ConfirmationDialog, {
            title: _t("Remove employee"),
            body: _t(
                "Archive %s and disable their login? Their past sales and attendance history stay intact — you can reactivate them later from 'Show Archived'.",
                form.user_name || ""
            ),
            confirmLabel: _t("Archive"),
            confirm: async () => {
                try {
                    // action_archive is a normal instance method — ids go
                    // in the first (and only) args slot, per Odoo's RPC
                    // convention for non-@api.model methods.
                    await this.orm.call("mobile.employee", "action_archive", [[form.id]]);
                    this.notification.add(_t("Employee archived"), { type: "success" });
                    this.state.panelOpen = false;
                    await this.loadEmployees();
                    if (this.state.attendance.length) {
                        await this.loadAttendance();
                    }
                } catch (error) {
                    const message =
                        (error && error.data && error.data.message) ||
                        _t("Could not archive this employee.");
                    this.notification.add(message, { type: "danger" });
                }
            },
            cancel: () => { },
        });
    }

    async reactivateEmployee(emp) {
        try {
            await this.orm.call("mobile.employee", "action_reactivate", [[emp.id]]);
            this.notification.add(_t("Employee reactivated"), { type: "success" });
            await this.loadEmployees();
        } catch (error) {
            const message =
                (error && error.data && error.data.message) ||
                _t("Could not reactivate this employee.");
            this.notification.add(message, { type: "danger" });
        }
    }

    /* ================================================================
       ATTENDANCE TAB
       ================================================================ */

    async loadAttendance() {
        this.state.attendanceLoading = true;
        try {
            this.state.attendance = await this.orm.searchRead(
                "mobile.employee.attendance",
                [],
                ["id", "employee_id", "login_time", "logout_time", "duration_hours"],
                { order: "login_time desc", limit: 500 }
            );
        } finally {
            this.state.attendanceLoading = false;
        }
    }

    setAttDateFilter(key) {
        this.state.attDateFilter = key;
    }

    setAttEmployeeFilter(ev) {
        const val = parseInt(ev.target.value, 10);
        this.state.attEmployeeFilter = isNaN(val) ? null : val;
    }

    get filteredAttendance() {
        const now = new Date();
        let list = this.state.attendance;

        if (this.state.attEmployeeFilter) {
            list = list.filter((a) => a.employee_id && a.employee_id[0] === this.state.attEmployeeFilter);
        }

        const key = this.state.attDateFilter;
        if (key === "all") {
            return list;
        }

        return list.filter((a) => {
            const dt = parseOdooDatetime(a.login_time);
            if (!dt) {
                return false;
            }
            if (key === "today") {
                return toDateStr(dt) === toDateStr(now);
            }
            if (key === "yesterday") {
                const y = new Date(now);
                y.setDate(y.getDate() - 1);
                return toDateStr(dt) === toDateStr(y);
            }
            if (key === "week") {
                const weekStart = new Date(now);
                const dow = (weekStart.getDay() + 6) % 7;
                weekStart.setDate(weekStart.getDate() - dow);
                weekStart.setHours(0, 0, 0, 0);
                return dt >= weekStart;
            }
            if (key === "month") {
                return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth();
            }
            return true;
        });
    }

    formatDateTime(str) {
        const dt = parseOdooDatetime(str);
        if (!dt) {
            return "—";
        }
        return dt.toLocaleString("en-LK", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    /* ================================================================
       SALARY TAB
       ================================================================ */

    async loadPayments() {
        this.state.paymentsLoading = true;
        try {
            this.state.payments = await this.orm.searchRead(
                "mobile.employee.salary.payment",
                [],
                ["id", "employee_id", "payment_date", "for_month", "amount", "notes"],
                { order: "payment_date desc", limit: 500 }
            );
        } finally {
            this.state.paymentsLoading = false;
        }
    }

    setPaymentEmployeeFilter(ev) {
        const val = parseInt(ev.target.value, 10);
        this.state.paymentEmployeeFilter = isNaN(val) ? null : val;
    }

    get filteredPayments() {
        if (!this.state.paymentEmployeeFilter) {
            return this.state.payments;
        }
        return this.state.payments.filter(
            (p) => p.employee_id && p.employee_id[0] === this.state.paymentEmployeeFilter
        );
    }

    get paymentsTotal() {
        return this.filteredPayments.reduce((sum, p) => sum + p.amount, 0);
    }

    openNewPayment() {
        this.state.paymentForm = emptyPaymentForm(
            this.state.paymentEmployeeFilter || (this.state.employees[0] && this.state.employees[0].id)
        );
        this.state.panelMode = "payment";
        this.state.panelOpen = true;
    }

    onPaymentFieldInput(field, ev) {
        this.state.paymentForm[field] = ev.target.value;
    }

    onPaymentNumberInput(field, ev) {
        const val = parseFloat(ev.target.value);
        this.state.paymentForm[field] = isNaN(val) ? 0 : val;
    }

    onPaymentEmployeeChange(ev) {
        this.state.paymentForm.employee_id = parseInt(ev.target.value, 10) || false;
    }

    async savePayment() {
        const form = this.state.paymentForm;
        if (!form.employee_id) {
            this.notification.add(_t("Choose an employee"), { type: "danger" });
            return;
        }
        if (!form.amount || form.amount <= 0) {
            this.notification.add(_t("Enter a valid amount"), { type: "danger" });
            return;
        }
        if (this.state.paymentSaving) {
            return;
        }
        this.state.paymentSaving = true;
        try {
            await this.orm.create("mobile.employee.salary.payment", [
                {
                    employee_id: form.employee_id,
                    payment_date: form.payment_date,
                    for_month: form.for_month,
                    amount: form.amount,
                    notes: form.notes,
                },
            ]);
            this.notification.add(_t("Salary payment logged"), { type: "success" });
            this.state.panelOpen = false;
            await this.loadPayments();
        } catch (error) {
            const message =
                (error && error.data && error.data.message) ||
                _t("Could not log this payment.");
            this.notification.add(message, { type: "danger" });
        } finally {
            this.state.paymentSaving = false;
        }
    }

    /* ================================================================
       SALES BY EMPLOYEE TAB
       ================================================================ */

    getSalesDateDomain() {
        const now = new Date();
        if (this.state.salesDateFilter === "today") {
            return [["sale_date", "=", toDateStr(now)]];
        }
        if (this.state.salesDateFilter === "month") {
            return [["sale_date", ">=", `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`]];
        }
        if (this.state.salesDateFilter === "year") {
            return [["sale_date", ">=", `${now.getFullYear()}-01-01`]];
        }
        return [];
    }

    setSalesDateFilter(key) {
        this.state.salesDateFilter = key;
        this.loadSales();
    }

    async loadSales() {
        this.state.salesLoading = true;
        try {
            const domain = [["state", "=", "confirmed"], ...this.getSalesDateDomain()];
            const orders = await this.orm.searchRead(
                "mobile.sale.order",
                domain,
                ["id", "cashier_id", "total_amount", "total_discount"]
            );
            const cashierMap = {};
            for (const order of orders) {
                if (!order.cashier_id) continue;
                const cid = order.cashier_id[0];
                const cname = order.cashier_id[1];
                if (!cashierMap[cid]) {
                    cashierMap[cid] = {
                        cashierId: cid,
                        cashierName: cname,
                        billCount: 0,
                        revenue: 0,
                        discount: 0,
                    };
                }
                cashierMap[cid].billCount += 1;
                cashierMap[cid].revenue += (order.total_amount || 0);
                cashierMap[cid].discount += (order.total_discount || 0);
            }
            this.state.salesRows = Object.values(cashierMap).sort((a, b) => b.revenue - a.revenue);
        } finally {
            this.state.salesLoading = false;
        }
    }

    get salesTotals() {
        return this.state.salesRows.reduce(
            (acc, r) => {
                acc.bills += r.billCount;
                acc.revenue += r.revenue;
                return acc;
            },
            { bills: 0, revenue: 0 }
        );
    }
}

registry.category("actions").add("mobile_shop_pos.employees_screen", MobileShopEmployeesScreen);
