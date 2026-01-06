require('dotenv').config();

const express = require('express');
const cors = require('cors');

const escpos = require('escpos');
escpos.Network = require('escpos-network');

const PRINTER_IP = process.env.PRINTER_IP || '192.168.0.100';
const PRINTER_PORT = process.env.PRINTER_PORT || 9100;

const app = express();
app.use(cors());
app.use(express.json());

function formatCurrencyAR(value) {
    const clean = String(value).replace(/[^0-9.-]/g, '');
    const number = Math.round(Number(clean) || 0);
    return `$${number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

function formatLine(leftText, rightText, maxLength = 42) {
    const spacesNeeded = maxLength - (leftText.length + rightText.length);
    return spacesNeeded > 0
        ? leftText + ' '.repeat(spacesNeeded) + rightText
        : `${leftText} ${rightText}`;
}

function buildItemName(it) {
    let baseMedallones = /doble/i.test(it.name) ? 2 : 1;

    if (it.extra_medallon) {
        baseMedallones += 1;
    }

    if (it.extra_2medallones) {
        baseMedallones += 2;
    }

    let cleanName = it.name
        .replace(/simple/i, '')
        .replace(/doble/i, '')
        .replace(/onion/i, '')
        .replace(/\s+/g, ' ')
        .trim();

    return `${cleanName} ${toRoman(baseMedallones)}`.trim();
}

function toRoman(num) {
    const romans = {
        1: 'I',
        2: 'II',
        3: 'III',
        4: 'IV',
        5: 'V'
    };
    return romans[num] || num.toString();
}

function toNumber(value) {
    return Math.round(
        Number(String(value).replace(/[^0-9.-]/g, '')) || 0
    );
}

app.post('/imprimir', (req, res) => {
    try {
        const order = req.body;

        if (!order || !order.items || !order.items.length) {
            return res.status(400).json({
                ok: false,
                message: 'Pedido inválido'
            });
        }

        const device = new escpos.Network(PRINTER_IP, PRINTER_PORT);
        const printer = new escpos.Printer(device);

        device.open((err) => {
            if (err) {
                console.error('Error de conexión:', err);
                return res.status(500).json({
                    ok: false,
                    message: 'No se pudo conectar con la impresora'
                });
            }

            try {
                printer
                    .hardware('init')
                    .encode('cp850')
                    .font('a')
                    .align('ct')
                    .style('b')
                    .size(1, 1)
                    .text(order.deliveryHour || '')
                    .font('b')
                    .feed(1)
                    .text(order.client || '');
                if (order.printComment) {
                    printer
                        .feed(1)
                        .align('lt')
                        .text(`OBS: ${order.printComment}`)
                        .align('ct')
                }
                printer.text('--------------------------------')
                    .align('lt');

                // ITEMS
                order.items.forEach(it => {
                    const mods = [];
                    if (it.extra_cheddar) mods.push('+ch');
                    if (it.extra_bacon) mods.push('+ba');
                    if (it.extra_papas) mods.push('+pp');
                    if (it.bbq) mods.push('+bbq');

                    const exclusions = [];
                    if (it.no_salsa) exclusions.push('s/s');
                    if (it.no_cheddar) exclusions.push('s/pp');
                    if (it.no_pepinos) exclusions.push('s/pep');
                    if (it.no_tomate) exclusions.push('s/tom');
                    if (it.no_lechuga) exclusions.push('s/lech');
                    if (it.no_bacon) exclusions.push('s/ba');

                    const unitPrice = (it.total_price / it.quantity);
                    let itemName;

                    if (it.recipe_id) {
                        itemName = buildItemName(it);
                    } else {
                        itemName = it.name;
                    }

                    for (let i = 0; i < it.quantity; i++) {
                        //printer.text(formatLine(it.name, formatCurrencyAR(unitPrice), 42));
                        printer.text(itemName);
                        if (mods.length > 0 || exclusions.length > 0) {
                            printer.text(
                                `  ${formatLine(mods.join(' '), exclusions.join(' · '), 36)}`
                            );
                        }

                    }
                    printer.feed(2);
                });

                printer
                    .text('--------------------------------')
                    .align('rt')
                    .style('b')
                    .text(`TOTAL: ${order.total}`)
                    .style('normal')
                    .align('lt');

                printer
                    .feed(1)
                    .font('b')
                    .align('lt')
                    .text(order.date || '')
                    .feed(3)
                    .raw(Buffer.from([0x1B, 0x42, 0x03, 0x02]))
                    .cut()
                    .close();

                return res.json({
                    ok: true,
                    message: 'Impresión exitosa'
                });

            } catch (printError) {
                console.error('Error durante impresión:', printError);
                return res.status(500).json({
                    ok: false,
                    message: 'Error durante la impresión'
                });
            }
        });

    } catch (error) {
        console.error('Error general:', error);
        return res.status(500).json({
            ok: false,
            message: 'Error interno del servidor'
        });
    }
});

app.listen(3000, () => {
    console.log('Servidor de Dimas Burgers escuchando en http://localhost:3000');
});
