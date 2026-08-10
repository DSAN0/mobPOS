from odoo import models, fields


class MobileSpecAttribute(models.Model):
    _name = "mobile.spec.attribute"
    _description = "Specification Type (e.g. Storage, RAM, Wattage)"

    name = fields.Char(
        string="Specification Name",
        required=True
    )

    _sql_constraints = [
        (
            'unique_attribute_name',
            'unique(name)',
            'This specification already exists!'
        )
    ]