from odoo import models


class ReportProductBarcodeLabel(models.AbstractModel):
    # Name must be "report." + the report action's report_name for Odoo
    # to find this when rendering mobile_shop_pos.report_product_barcode_label_document.
    _name = 'report.mobile_shop_pos.report_product_barcode_label_document'
    _description = 'Product Barcode Label Report'

    def _get_report_values(self, docids, data=None):
        docs = self.env['mobile.phone.product'].browse(docids)
        # label_qty travels in via additionalContext on the JS doAction
        # call (the same mechanism active_ids already uses for every
        # other report in this module), not via the data param, which
        # isn't reliably populated for a plain client-side print.
        label_qty = self.env.context.get('label_qty') or 1
        try:
            label_qty = max(1, int(label_qty))
        except (TypeError, ValueError):
            label_qty = 1
        return {
            'doc_ids': docids,
            'doc_model': 'mobile.phone.product',
            'docs': docs,
            'label_qty': label_qty,
        }
