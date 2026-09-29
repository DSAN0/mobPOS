/** @odoo-module **/

// Shared by every custom screen. Odoo's own login/logout flow has no
// stable extension point we can safely hook without depending on
// internal controller/method names that can (and, in this project,
// already have — see the ir.actions.act_window groups_id -> group_ids
// rename) change between versions. Instead we track attendance from the
// client, at moments we control directly:
//   - ensureCheckedIn(): call once when any screen mounts. Idempotent —
//     if there's already an open attendance record for today it's a
//     no-op server-side, so it's safe to call from every screen.
//   - checkOutAndLogout(): call from the "Log Out" button. Closes the
//     open attendance record, then sends the browser to Odoo's own
//     logout URL — a stable, public route, not an internal API.
//
// If a Cashier/Manager logs out via the standard Odoo avatar menu
// instead of this button, the logout time simply won't be recorded —
// there is no reliable way to intercept that from here. Encourage staff
// to use the in-screen Log Out button.

export async function ensureCheckedIn(orm) {
    try {
        await orm.call("mobile.employee.attendance", "check_in", []);
    } catch {
        // Best-effort: e.g. this user has no mobile.employee profile yet
        // (admin/demo accounts). Never block the screen over this.
    }
}

export async function checkOutAndLogout(orm) {
    try {
        await orm.call("mobile.employee.attendance", "check_out", []);
    } finally {
        window.location.href = "/web/session/logout";
    }
}
