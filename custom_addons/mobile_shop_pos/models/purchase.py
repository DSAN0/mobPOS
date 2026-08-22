from odoo import models, fields, api


class MobilePurchaseOrder(models.Model):
    _name = "mobile.purchase.order"
    _description = "Add Stock"

    name = fields.Char(
        string="Reference",
        required=True,
        default="New"
    )

    purchase_date = fields.Date(
        string="Date",
        default=fields.Date.today
    )

    state = fields.Selection(
        [
            ('draft', 'Draft'),
            ('received', 'Received'),
        ],
        string="Status",
        default="draft"
    )

    line_ids = fields.One2many(
        "mobile.purchase.line",
        "purchase_id",
        string="Items"
    )

    total_amount = fields.Float(
        string="Total Amount",
        compute="_compute_total",
        store=True
    )

    @api.depends('line_ids.subtotal')
    def _compute_total(self):
        for order in self:
            order.total_amount = sum(line.subtotal for line in order.line_ids)

    def action_receive(self):
        for order in self:
            if order.state == 'received':
                continue

            for line in order.line_ids:
                # sudo(): updating stock/cost on receipt is a system action
                # tied to this specific operation, not a general product
                # edit — Cashiers can add stock without needing broad write
                # access to mobile.phone.product.
                product = line.product_id.sudo()
                product.stock_quantity += line.quantity
                if line.cost_price:
                    product.purchase_price = line.cost_price

            order.state = 'received'


class MobilePurchaseLine(models.Model):
    _name = "mobile.purchase.line"
    _description = "Add Stock Line"

    purchase_id = fields.Many2one(
        "mobile.purchase.order",
        string="Stock In Reference",
        ondelete="cascade"
    )

    product_id = fields.Many2one(
        "mobile.phone.product",
        string="Product",
        required=True
    )

    quantity = fields.Integer(
        string="Quantity",
        default=1
    )

    cost_price = fields.Float(
        string="Cost Price (per unit)"
    )

    subtotal = fields.Float(
        string="Subtotal",
        compute="_compute_subtotal",
        store=True
    )

    @api.depends('quantity', 'cost_price')
    def _compute_subtotal(self):
        for line in self:
            line.subtotal = line.quantity * line.cost_price