from odoo import models, fields, api
from odoo.exceptions import UserError


class MobileRepairOrder(models.Model):
    _name = "mobile.repair.order"
    _description = "Repair Job"
    _order = "id desc"

    _name_uniq = models.Constraint('UNIQUE (name)', 'The Job Number must be unique!')

    name = fields.Char(
        string="Job No",
        required=True,
        default="New",
        copy=False,
        readonly=True,
    )

    customer_name = fields.Char(string="Customer Name", required=True)
    customer_phone = fields.Char(string="Customer Phone", required=True)
    device = fields.Char(string="Device", required=True, help="e.g. iPhone 13 Pro Max")
    issue_description = fields.Text(string="Issue", required=True)

    status = fields.Selection(
        [
            ('received', 'Received'),
            ('in_progress', 'In Progress'),
            ('ready', 'Ready for Pickup'),
            ('delivered', 'Delivered'),
            ('cancelled', 'Cancelled'),
        ],
        string="Status",
        default="received",
        required=True,
    )

    cost = fields.Float(string="Estimated Cost", default=0.0)
    additional_cost = fields.Float(string="Additional Cost", default=0.0)
    additional_cost_reason = fields.Char(string="Additional Cost Reason")
    total_cost = fields.Float(string="Total Cost", compute="_compute_total_cost", store=True)

    received_date = fields.Datetime(string="Received Date & Time", default=fields.Datetime.now)
    delivered_date = fields.Datetime(string="Delivered Date & Time")

    notes = fields.Text(string="Notes")

    def _auto_init(self):
        super()._auto_init()
        # Keep ir.sequence synchronized with existing repair job numbers
        cr = self.env.cr
        cr.execute("SELECT name FROM mobile_repair_order WHERE name LIKE 'REP-%'")
        names = [r[0] for r in cr.fetchall()]
        max_num = 0
        for n in names:
            try:
                num = int(n.replace('REP-', ''))
                if num > max_num:
                    max_num = num
            except Exception:
                pass
        if max_num > 0:
            seq = self.env['ir.sequence'].search([('code', '=', 'mobile.repair.order')], limit=1)
            if seq and seq.number_next <= max_num:
                seq.number_next = max_num + 1

    @api.depends('cost', 'additional_cost')
    def _compute_total_cost(self):
        for rec in self:
            rec.total_cost = (rec.cost or 0.0) + (rec.additional_cost or 0.0)

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if not vals.get('name') or vals.get('name') == 'New':
                seq = self.env['ir.sequence'].next_by_code('mobile.repair.order') or 'New'
                while seq != 'New' and self.search_count([('name', '=', seq)]):
                    seq = self.env['ir.sequence'].next_by_code('mobile.repair.order') or 'New'
                vals['name'] = seq
        return super().create(vals_list)

    def action_update_additional_cost(self, additional_cost=0.0, reason=''):
        for rec in self:
            rec.write({
                'additional_cost': float(additional_cost or 0.0),
                'additional_cost_reason': reason or False,
            })
        return True

    def action_mark_in_progress(self):
        for rec in self:
            rec.status = 'in_progress'

    def action_mark_ready(self):
        for rec in self:
            rec.status = 'ready'

    def action_mark_delivered(self, additional_cost=None, reason=None):
        for rec in self:
            vals = {
                'status': 'delivered',
                'delivered_date': fields.Datetime.now(),
            }
            if additional_cost is not None:
                vals['additional_cost'] = float(additional_cost or 0.0)
            if reason is not None:
                vals['additional_cost_reason'] = reason or False
            rec.write(vals)
        return True

    def action_cancel(self):
        if not self.env.user.has_group('mobile_shop_pos.group_mobile_shop_manager'):
            raise UserError("Only the Owner/Manager can cancel a repair job.")
        for rec in self:
            rec.status = 'cancelled'