from odoo import models, fields, api, _
from odoo.exceptions import UserError, AccessError


class MobileEmployeePosition(models.Model):
    _name = "mobile.employee.position"
    _description = "Employee Position (e.g. Cashier, Manager)"

    name = fields.Char(string="Position", required=True)

    _sql_constraints = [
        (
            'unique_position_name',
            'unique(name)',
            'This position already exists!'
        )
    ]


class MobileEmployee(models.Model):
    _name = "mobile.employee"
    _description = "Employee Profile"
    _order = "name"

    # The actual login this profile is linked to. Owners/Managers create
    # this directly from the Manage Employees screen (see
    # action_create_login below) — they don't have Settings access in
    # this shop's setup, only the Administrator does. action_create_login
    # is careful to only ever grant the Cashier or Owner/Manager group,
    # never anything broader, so this convenience can't be used to hand
    # out admin rights.
    user_id = fields.Many2one(
        "res.users",
        string="Login Account",
        required=True,
        ondelete="restrict",
        help="The system login this profile is linked to. Usually created "
             "directly from Manage Employees > Add Employee (Owner/Manager "
             "only — no Settings access needed). You can also link an "
             "already-existing login instead, e.g. the Administrator's own "
             "account for an Owner profile."
    )

    name = fields.Char(related="user_id.name", string="Name", store=True, readonly=True)

    position_id = fields.Many2one(
        "mobile.employee.position",
        string="Position",
        required=True
    )

    phone = fields.Char(string="Phone")
    nic = fields.Char(string="NIC / ID Number")
    join_date = fields.Date(string="Joined On", default=fields.Date.today)
    basic_salary = fields.Float(string="Basic Salary")
    notes = fields.Text(string="Notes")

    active = fields.Boolean(
        default=True,
        string="Active",
        help="Uncheck (Archive) instead of deleting to keep this "
             "employee's sales and attendance history intact and "
             "readable in reports."
    )

    attendance_ids = fields.One2many(
        "mobile.employee.attendance", "employee_id", string="Attendance"
    )
    salary_payment_ids = fields.One2many(
        "mobile.employee.salary.payment", "employee_id", string="Salary Payments"
    )

    _sql_constraints = [
        (
            'unique_user',
            'unique(user_id)',
            'This user already has an employee profile.'
        )
    ]

    # ------------------------------------------------------------------
    # Creating the actual login here (instead of sending the Owner to
    # Settings > Users) is deliberate: in this shop's setup only the
    # Administrator account has access to Settings, and the Owner/Manager
    # group is intentionally NOT given that access (it's a much bigger
    # permission than running a shop day-to-day). So this method uses
    # sudo() to do the one thing the Owner actually needs — create a
    # login — but it hard-codes the choice to exactly ONE of the two POS
    # groups plus the plain "Internal User" group. It never accepts a
    # group id from the client, so there's no way for this screen to be
    # used to grant admin/system access to anyone.
    # ------------------------------------------------------------------
    @api.model
    def action_create_login(self, user_vals, employee_vals, role):
        if not self.env.user.has_group('mobile_shop_pos.group_mobile_shop_manager'):
            raise AccessError(_("Only the Owner/Manager can add employees."))

        if role not in ('cashier', 'manager'):
            raise UserError(_("Invalid role."))

        name = (user_vals or {}).get('name', '').strip()
        login = (user_vals or {}).get('login', '').strip()
        password = (user_vals or {}).get('password', '')

        if not name:
            raise UserError(_("Name is required."))
        if not login:
            raise UserError(_("Login / email is required."))
        if not password or len(password) < 4:
            raise UserError(_("Password must be at least 4 characters."))

        Users = self.env['res.users'].sudo()
        if Users.with_context(active_test=False).search_count([('login', '=', login)]):
            raise UserError(_("A user with this login already exists."))

        role_group = self.env.ref(
            'mobile_shop_pos.group_mobile_shop_manager' if role == 'manager'
            else 'mobile_shop_pos.group_mobile_shop_cashier'
        )
        internal_group = self.env.ref('base.group_user')

        new_user = Users.create({
            'name': name,
            'login': login,
            'password': password,
            'group_ids': [(6, 0, [internal_group.id, role_group.id])],
        })

        employee_vals = dict(employee_vals or {})
        employee_vals['user_id'] = new_user.id
        employee = self.create(employee_vals)
        return employee.id

    def action_archive(self):
        if not self.env.user.has_group('mobile_shop_pos.group_mobile_shop_manager'):
            raise AccessError(_("Only the Owner/Manager can remove employees."))
        for emp in self:
            if emp.user_id.id == self.env.uid:
                raise UserError(_("You can't archive your own employee profile while logged in as them."))
            emp.active = False
            # sudo(): disabling the linked login is part of "removing" the
            # employee, not a general grant of res.users access to
            # Managers — see action_create_login for the same reasoning.
            emp.user_id.sudo().active = False

    def action_reactivate(self):
        if not self.env.user.has_group('mobile_shop_pos.group_mobile_shop_manager'):
            raise AccessError(_("Only the Owner/Manager can restore employees."))
        for emp in self:
            emp.active = True
            emp.user_id.sudo().active = True


class MobileEmployeeAttendance(models.Model):
    _name = "mobile.employee.attendance"
    _description = "Employee Login / Logout Record"
    _order = "login_time desc"

    employee_id = fields.Many2one(
        "mobile.employee",
        string="Employee",
        required=True,
        ondelete="cascade"
    )
    user_id = fields.Many2one(
        related="employee_id.user_id", string="User", store=True
    )

    login_time = fields.Datetime(string="Login Time", required=True, default=fields.Datetime.now)
    logout_time = fields.Datetime(string="Logout Time")

    duration_hours = fields.Float(string="Hours", compute="_compute_duration", store=True)

    @api.depends('login_time', 'logout_time')
    def _compute_duration(self):
        for att in self:
            if att.login_time and att.logout_time:
                delta = att.logout_time - att.login_time
                att.duration_hours = delta.total_seconds() / 3600.0
            else:
                att.duration_hours = 0.0

    # ------------------------------------------------------------------
    # check_in / check_out are called from the client (see
    # static/src/utils/attendance.js) — check_in the first time any
    # screen loads after login, check_out right before the client sends
    # the browser to /web/session/logout.
    #
    # sudo() is deliberate: Cashiers have no ACL rows at all on this model
    # (see ir.model.access.csv) since they should only ever be able to
    # touch their OWN attendance record, never anyone else's. That's what
    # actually enforces the boundary here — both methods derive the
    # employee from self.env.uid (who the server knows is authenticated),
    # never from anything the client sends.
    #
    # @api.model matters here too: the JS side calls these with an empty
    # args list (there's no specific record to act on), and Odoo's RPC
    # dispatch treats a plain instance method's first arg as a list of
    # ids to browse — an empty args list would raise IndexError before
    # the method body even runs. @api.model routes the call differently
    # (self is bound to the model, not a browsed recordset), which is
    # what actually matches how these are invoked.
    # ------------------------------------------------------------------

    @api.model
    def check_in(self):
        employee = self.env['mobile.employee'].sudo().search(
            [('user_id', '=', self.env.uid)], limit=1
        )
        if not employee:
            return False
        open_att = self.sudo().search([
            ('employee_id', '=', employee.id),
            ('logout_time', '=', False),
        ], limit=1)
        if open_att:
            return open_att.id
        return self.sudo().create({'employee_id': employee.id}).id

    @api.model
    def check_out(self):
        employee = self.env['mobile.employee'].sudo().search(
            [('user_id', '=', self.env.uid)], limit=1
        )
        if not employee:
            return False
        open_att = self.sudo().search([
            ('employee_id', '=', employee.id),
            ('logout_time', '=', False),
        ], order='login_time desc', limit=1)
        if open_att:
            open_att.logout_time = fields.Datetime.now()
            return True
        return False


class MobileEmployeeSalaryPayment(models.Model):
    _name = "mobile.employee.salary.payment"
    _description = "Salary Payment"
    _order = "payment_date desc"

    employee_id = fields.Many2one(
        "mobile.employee",
        string="Employee",
        required=True,
        ondelete="cascade"
    )
    payment_date = fields.Date(string="Payment Date", required=True, default=fields.Date.today)
    for_month = fields.Char(string="For Month", help="e.g. 'September 2026'")
    amount = fields.Float(string="Amount", required=True)
    notes = fields.Char(string="Notes")
