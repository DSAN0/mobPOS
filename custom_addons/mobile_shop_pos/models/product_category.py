from odoo import models, fields


class MobileProductCategory(models.Model):
    _name = "mobile.product.category"
    _description = "Product Category"

    name = fields.Char(
        string="Category Name",
        required=True
    )

    _sql_constraints = [
        (
            'unique_category_name',
            'unique(name)',
            'This category already exists!'
        )
    ]