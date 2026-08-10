from odoo import models, fields


class MobileProductSpec(models.Model):
    _name = "mobile.product.spec"
    _description = "Product Specification Line"
    _order = "sequence, id"

    product_id = fields.Many2one(
        "mobile.phone.product",
        string="Product",
        ondelete="cascade",
        required=True
    )

    attribute_id = fields.Many2one(
        "mobile.spec.attribute",
        string="Specification",
        required=True
    )

    value = fields.Char(
        string="Value",
        required=True
    )

    sequence = fields.Integer(
        string="Sequence",
        default=10
    )

    _sql_constraints = [
        (
            'unique_product_attribute',
            'unique(product_id, attribute_id)',
            'This specification is already added for this product.'
        )
    ]