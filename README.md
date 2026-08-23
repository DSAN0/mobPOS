# Mobile Shop POS & Repair Management

Custom Odoo 19 addons built for a mobile phone & accessories shop in Sri Lanka — a lightweight point-of-sale system and a repair job tracker, both designed to run on a single local PC with role-based access for a Cashier and an Owner/Manager.

This is **not** a generic POS package — it's a purpose-built system for one shop's actual workflow: sell phones and accessories, restock inventory, track repair jobs from intake to delivery, and print proper receipts, all without needing an internet connection.

---

## Modules

### 1. `mobile_shop_pos` — Point of Sale

- **POS Screen** — tap-to-sell interface with product search, category filters, cart, cash/card/online payment, change calculator, and one-tap "Show Details" per product (specs, warranty, stock) so staff can answer customer questions without leaving the screen.
- **Products** — catalog management (brand, model, category, custom specifications, pricing, stock levels, reorder threshold, warranty). Owner/Manager only.
- **Add Stock** — restocking screen that updates quantity and cost price. Owner/Manager only.
- **Create Bill** — classic backend list/form view of bills, kept as a manual/backup option for the Owner.
- **Sales Report** — pivot/graph/list view of sales with cost and profit, grouped by category/brand/product/date. Owner/Manager only.
- **Receipts** — full-color A4 receipt with shop logo, name, date/time, and per-item warranty. Auto-prints on sale confirmation.

### 2. `mobile_repair` — Repair Job Tracking

- **Repair Screen** — log a new repair (customer name/phone, device, issue, estimated cost) and track it through **Received → In Progress → Ready for Pickup → Delivered** (or **Cancelled**, Owner/Manager only).
- **Two auto-printed receipts per job**:
  - **Intake Receipt** — printed the moment a job is logged; shows received date & time, customer details, device, issue, and estimated cost.
  - **Delivery Receipt** — printed the moment a job is marked Delivered; shows both received *and* handover date & time, final cost, and a signature line for shop/customer.
- Depends on `mobile_shop_pos` — reuses its Cashier/Owner security groups rather than defining its own.

---

## User Roles

Both modules share a single security setup, defined in `mobile_shop_pos`:

| Role | Can do |
|---|---|
| **Cashier** | Sell via POS Screen, log & progress repair jobs, view product details (no cost/profit visible). Cannot add stock, cancel bills, cancel repairs, edit products/categories, or view Sales Report. |
| **Owner / Manager** | Everything — full product/catalog management, stock control, bill and repair cancellation, cost & profit visibility, Sales Report. |

Cost price, purchase price, and profit figures are never exposed to the Cashier role — enforced server-side, not just hidden in the UI.

The Cashier's login lands directly on POS Screen (via their Home Action) and only shows what their role permits; switching to the Repair app is done through the standard Odoo app switcher.

---

## Tech Stack

- **Odoo 19.0** (Community) — backend models, ORM, security, QWeb PDF reports
- **Python** — business logic, custom models
- **OWL (Odoo Web Library)** — custom-built kiosk-style screens (POS Screen, Products, Add Stock, Repair Screen)
- **PostgreSQL** — database
- Runs entirely **offline** on a single local Windows PC — no internet dependency for daily operation

---

## Project Structure

```
custom_addons/
├── mobile_shop_pos/
│   ├── models/          # Product, category, spec, purchase, sale
│   ├── security/        # Cashier/Manager groups + access rules
│   ├── views/            # Menus, backend forms, sales report
│   ├── reports/          # A4 color sale receipt (QWeb)
│   ├── data/              # Sequences, default category data
│   └── static/src/       # POS Screen, Products, Add Stock (OWL components)
│
└── mobile_repair/
    ├── models/          # Repair job model
    ├── security/        # Access rules (reuses mobile_shop_pos groups)
    ├── views/            # Repair menu/action
    ├── reports/          # Intake + Delivery receipts (QWeb)
    ├── data/              # Job number sequence
    └── static/src/       # Repair Screen (OWL component)
```

---

## Installation

1. Clone both `mobile_shop_pos` and `mobile_repair` into your Odoo instance's `custom_addons` directory.
2. Make sure `custom_addons` is listed in your `odoo.conf` under `addons_path`.
3. Install:
   ```
   python odoo-bin -c odoo.conf -d <your_database> -i mobile_shop_pos -i mobile_repair
   ```
4. Go to **Settings → Companies** and set your shop's real name, logo, and address — both receipt templates pull this automatically.
5. Go to **Settings → Users** and create logins for your Cashier(s) and Owner, assigning them the appropriate group under the **Mobile Shop** access category.

> **Note:** any change to a `.py` model file requires a full server restart (`Ctrl+C`, then rerun with `-u <module_name>`) — the in-browser "Upgrade" button only picks up XML/CSS/JS changes, not Python.

---

## Configuration Notes

- Set `list_db = False` and `dbfilter` in `odoo.conf` for a production deployment on a dedicated shop PC — hides the database manager entirely.
- `workers` must stay `0` on Windows (Odoo's multi-worker mode requires Linux).
- Run Odoo as a Windows Service (e.g. via NSSM) rather than a manual terminal session, so it survives reboots.
- Receipts require an actual A4, color-capable printer — this system does not target thermal receipt printers.

---

## License

Proprietary — built for a single shop's internal use. Not licensed for redistribution or resale without permission.
