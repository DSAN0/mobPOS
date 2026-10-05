/** @odoo-module **/

/**
 * Sends an Odoo HTML receipt report directly to the physical printer
 * (e.g. Hoin HOP-HL80B 80mm thermal receipt printer) using an invisible
 * iframe and native window.print(), avoiding digital PDF downloads.
 *
 * @param {string} reportName - e.g. "mobile_shop_pos.report_mobile_sale_document"
 * @param {number|number[]} docIds - Record ID or array of IDs
 * @returns {Promise<void>}
 */
export function printReceiptReport(reportName, docIds) {
    return new Promise((resolve) => {
        const ids = Array.isArray(docIds) ? docIds.join(",") : docIds;
        const url = `/report/html/${reportName}/${ids}`;

        // Clean up any previously attached receipt iframe
        const oldIframe = document.getElementById("o_pos_thermal_print_frame");
        if (oldIframe) {
            oldIframe.remove();
        }

        const iframe = document.createElement("iframe");
        iframe.id = "o_pos_thermal_print_frame";
        iframe.style.position = "fixed";
        iframe.style.top = "-9999px";
        iframe.style.left = "-9999px";
        iframe.style.width = "80mm";
        iframe.style.height = "100px";
        iframe.style.border = "none";
        iframe.style.opacity = "0";
        iframe.style.pointerEvents = "none";

        iframe.onload = () => {
            try {
                const doc = iframe.contentDocument || iframe.contentWindow.document;
                
                // Inject 80mm thermal roll print CSS
                const style = doc.createElement("style");
                style.textContent = `
                    @page {
                        size: 80mm auto;
                        margin: 0mm !important;
                    }
                    *, *:before, *:after {
                        box-sizing: border-box !important;
                    }
                    html, body {
                        margin: 0 !important;
                        padding: 0 !important;
                        background: #ffffff !important;
                        color: #000000 !important;
                        width: 100% !important;
                        min-width: 100% !important;
                        max-width: 100% !important;
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                    .page, .container, .o_thermal_receipt, div.page {
                        width: 100% !important;
                        min-width: 100% !important;
                        max-width: 100% !important;
                        margin: 0 !important;
                        padding: 2px 4px !important;
                        box-sizing: border-box !important;
                    }
                    table {
                        width: 100% !important;
                        min-width: 100% !important;
                        max-width: 100% !important;
                        table-layout: auto !important;
                    }
                    img {
                        max-width: 100% !important;
                    }
                `;
                doc.head.appendChild(style);

                // Allow 200ms for images/barcodes to render before triggering physical print
                setTimeout(() => {
                    iframe.contentWindow.focus();
                    iframe.contentWindow.print();
                    resolve();
                }, 200);
            } catch (err) {
                console.error("Physical thermal print error:", err);
                resolve();
            }
        };

        iframe.onerror = (err) => {
            console.error("Failed to load receipt HTML:", err);
            resolve();
        };

        iframe.src = url;
        document.body.appendChild(iframe);
    });
}
