from odoo import models, fields, api


class MobilePhoneProduct(models.Model):
    _name = "mobile.phone.product"
    _description = "Shop Product"

    name = fields.Char(
        string="Product Name",
        compute="_compute_name",
        store=True
    )

    category_id = fields.Many2one(
        "mobile.product.category",
        string="Category",
        required=True
    )

    brand = fields.Char(string="Brand", required=True)
    model_name = fields.Char(string="Model", required=True)

    spec_ids = fields.One2many(
        "mobile.product.spec",
        "product_id",
        string="Specifications"
    )

    spec_summary = fields.Char(
        string="Specifications",
        compute="_compute_spec_summary",
        store=True
    )

    purchase_price = fields.Float(string="Purchase Price")
    selling_price = fields.Float(string="Selling Price")

    stock_quantity = fields.Integer(
        string="Stock Quantity",
        default=0
    )

    reorder_level = fields.Integer(
        string="Reorder Level",
        default=5,
        help="You'll be alerted when stock falls to or below this number."
    )

    is_low_stock = fields.Boolean(
        string="Low Stock",
        compute="_compute_is_low_stock",
        store=True
    )

    warranty = fields.Char(
        string="Warranty",
        help="e.g. '1 Year', '6 Months'. Leave blank if this product has no warranty."
    )

    image = fields.Image(string="Product Image")
    notes = fields.Text(string="Notes")

    @api.depends('brand', 'model_name', 'spec_ids.value')
    def _compute_name(self):
        for product in self:
            parts = [product.brand, product.model_name]
            parts += [line.value for line in product.spec_ids if line.value]
            product.name = " ".join(p for p in parts if p)

    @api.depends('spec_ids.value', 'spec_ids.attribute_id.name')
    def _compute_spec_summary(self):
        for product in self:
            parts = [
                f"{line.attribute_id.name}: {line.value}"
                for line in product.spec_ids
                if line.attribute_id and line.value
            ]
            product.spec_summary = ", ".join(parts)

    @api.depends('stock_quantity', 'reorder_level')
    def _compute_is_low_stock(self):
        for product in self:
            product.is_low_stock = product.stock_quantity <= product.reorder_level

    _sql_constraints = [
        (
            'unique_name',
            'unique(name)',
            'A product with this exact name already exists — just add '
            'stock to it instead of creating a duplicate.'
        )
    ]