{
    "name": "Mobile Shop Repairs",
    "version": "19.0.1.0.0",
    "category": "Services",
    "summary": "Repair job tracking for the mobile shop",
    "author": "Your Name",
    "license": "LGPL-3",
    "depends": [
        "base",
        "mobile_shop_pos",
    ],
    "data": [
        "security/ir.model.access.csv",
        "data/sequence.xml",
        "views/repair_screen_views.xml",
        "reports/repair_receipts.xml",
    ],
    "assets": {
        "web.assets_backend": [
            "mobile_repair/static/src/repair_screen/repair_screen.js",
            "mobile_repair/static/src/repair_screen/repair_screen.xml",
            "mobile_repair/static/src/repair_screen/repair_screen.scss",
        ],
    },
    "installable": True,
    "application": True,
    "auto_install": False,
}