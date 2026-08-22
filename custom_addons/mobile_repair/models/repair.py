from odoo import models, fields, api
from odoo.exceptions import UserError


class MobileRepairOrder(models.Model):
    _name = "mobile.repair.order"
    _description = "Repair Job"
    _order = "id desc"

    name = fields.Char(
        string="Job No",
        required=True,
        default="New"
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

    cost = fields.Float(string="Cost")

    received_date = fields.Datetime(string="Received Date & Time", default=fields.Datetime.now)
    delivered_date = fields.Datetime(string="Delivered Date & Time")

    notes = fields.Text(string="Notes")

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', 'New') == 'New':
                vals['name'] = self.env['ir.sequence'].next_by_code('mobile.repair.order') or 'New'
        return super().create(vals_list)

    def action_mark_in_progress(self):
        for rec in self:
            rec.status = 'in_progress'

    def action_mark_ready(self):
        for rec in self:
            rec.status = 'ready'

    def action_mark_delivered(self):
        for rec in self:
            rec.status = 'delivered'
            rec.delivered_date = fields.Datetime.now()

    def action_cancel(self):
        if not self.env.user.has_group('mobile_shop_pos.group_mobile_shop_manager'):
            raise UserError("Only the Owner/Manager can cancel a repair job.")
        for rec in self:
            rec.status = 'cancelled'