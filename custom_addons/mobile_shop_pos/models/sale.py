from odoo import models, fields, api
from odoo.exceptions import UserError


class MobileSaleOrder(models.Model):
    _name = "mobile.sale.order"
    _description = "Sale Bill"

    name = fields.Char(
        string="Bill No",
        required=True,
        default="New"
    )

    sale_date = fields.Date(
        string="Date",
        default=fields.Date.today
    )

    state = fields.Selection(
        [
            ('draft', 'Draft'),
            ('confirmed', 'Confirmed'),
            ('cancelled', 'Cancelled'),
        ],
        string="Status",
        default="draft"
    )

    line_ids = fields.One2many(
        "mobile.sale.line",
        "sale_id",
        string="Items"
    )

    total_amount = fields.Float(
        string="Total Amount",
        compute="_compute_total",
        store=True
    )

    payment_method = fields.Selection(
        [
            ('cash', 'Cash'),
            ('card', 'Card'),
            ('online', 'Online Transfer'),
        ],
        string="Payment Method",
        default='cash'
    )

    amount_tendered = fields.Float(
        string="Amount Tendered"
    )

    change_due = fields.Float(
        string="Change Due",
        compute="_compute_change_due",
        store=True
    )

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', 'New') == 'New':
                vals['name'] = self.env['ir.sequence'].next_by_code('mobile.sale.order') or 'New'
        return super().create(vals_list)

    @api.depends('line_ids.subtotal')
    def _compute_total(self):
        for sale in self:
            sale.total_amount = sum(line.subtotal for line in sale.line_ids)

    @api.depends('total_amount', 'amount_tendered')
    def _compute_change_due(self):
        for sale in self:
            sale.change_due = sale.amount_tendered - sale.total_amount

    def action_confirm(self):
        for sale in self:
            if sale.state != 'draft':
                continue

            if not sale.line_ids:
                raise UserError("Add at least one item before confirming.")

            if sale.payment_method == 'cash' and sale.amount_tendered < sale.total_amount:
                raise UserError(
                    f"Amount tendered (LKR {sale.amount_tendered:,.2f}) is less "
                    f"than the total (LKR {sale.total_amount:,.2f}). "
                    f"Please collect the full amount before confirming."
                )

            for line in sale.line_ids:
                if line.quantity > line.product_id.stock_quantity:
                    raise UserError(
                        f"Not enough stock for '{line.product_id.name}'. "
                        f"Available: {line.product_id.stock_quantity}, "
                        f"requested: {line.quantity}."
                    )

            for line in sale.line_ids:
                # sudo(): decrementing stock on confirm is a system action,
                # not a general product edit — Cashiers can confirm sales
                # without needing broad write access to mobile.phone.product.
                line.product_id.sudo().stock_quantity -= line.quantity

            sale.state = 'confirmed'

    def action_cancel(self):
        for sale in self:
            if sale.state != 'confirmed':
                continue

            for line in sale.line_ids:
                line.product_id.sudo().stock_quantity += line.quantity

            sale.state = 'cancelled'


class MobileSaleLine(models.Model):
    _name = "mobile.sale.line"
    _description = "Sale Bill Line"

    sale_id = fields.Many2one(
        "mobile.sale.order",
        string="Bill",
        ondelete="cascade"
    )

    product_id = fields.Many2one(
        "mobile.phone.product",
        string="Product",
        required=True,
        domain="[('stock_quantity', '>', 0)]"
    )

    brand = fields.Char(related="product_id.brand", string="Brand", store=True)
    model_name = fields.Char(related="product_id.model_name", string="Model", store=True)
    category_id = fields.Many2one(related="product_id.category_id", string="Category", store=True)
    sale_date = fields.Date(related="sale_id.sale_date", string="Date", store=True)
    state = fields.Selection(related="sale_id.state", string="Bill Status", store=True)

    quantity = fields.Integer(
        string="Quantity",
        default=1
    )

    price = fields.Float(
        string="Unit Price"
    )

    cost_price = fields.Float(
        string="Unit Cost",
        help="Snapshot of the product's purchase price at the time of this sale."
    )

    subtotal = fields.Float(
        string="Subtotal",
        compute="_compute_subtotal",
        store=True
    )

    cost_total = fields.Float(
        string="Total Cost",
        compute="_compute_cost_total",
        store=True
    )

    profit = fields.Float(
        string="Profit",
        compute="_compute_profit",
        store=True
    )

    @api.model_create_multi
    def create(self, vals_list):
        # The client (POS Screen) never sends cost_price, and even if it did,
        # we don't trust it: cashiers create these records too, and cost/
        # profit numbers must not be client-settable. Always snapshot the
        # product's current purchase_price at creation time instead.
        for vals in vals_list:
            product_id = vals.get('product_id')
            if product_id:
                product = self.env['mobile.phone.product'].browse(product_id)
                vals['cost_price'] = product.purchase_price
        return super().create(vals_list)

    @api.onchange('product_id')
    def _onchange_product_id(self):
        if self.product_id:
            self.price = self.product_id.selling_price
            self.cost_price = self.product_id.purchase_price

    @api.depends('quantity', 'price')
    def _compute_subtotal(self):
        for line in self:
            line.subtotal = line.quantity * line.price

    @api.depends('quantity', 'cost_price')
    def _compute_cost_total(self):
        for line in self:
            line.cost_total = line.quantity * line.cost_price

    @api.depends('subtotal', 'cost_total')
    def _compute_profit(self):
        for line in self:
            line.profit = line.subtotal - line.cost_total