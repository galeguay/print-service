/*comando de reset de estado
printer._raw(Buffer.from([0x1B, 0x40]));
resetea font

resetea align

resetea style

resetea encoding */

require('dotenv').config();

const express = require('express');
const cors = require('cors');

const escpos = require('escpos');
escpos.Network = require('escpos-network');

const PRINTER_IP = process.env.PRINTER_IP || '192.168.1.100';
const PRINTER_PORT = process.env.PRINTER_PORT || 9100;
const COL_A = 48;
const COL_B = 64;

const app = express();
app.use(cors());
app.use(express.json());

function formatCurrencyAR(value) {
    const clean = String(value).replace(/[^0-9.-]/g, '');
    const number = Math.round(Number(clean) || 0);
    return `$${number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

function formatLine(leftText, rightText, maxLength = COL_A) {
    const spacesNeeded = maxLength - (leftText.length + rightText.length);
    return spacesNeeded > 0
        ? leftText + ' '.repeat(spacesNeeded) + rightText
        : `${leftText} ${rightText}`;
}

function buildItemName(it) {
    const nombre = it.name ?? it.nombre ?? '';

    let baseMedallones = /doble/i.test(nombre) ? 2 : 1;

    if (it.extra_medallon) {
        baseMedallones += 1;
    }

    if (it.extra_2medallones) {
        baseMedallones += 2;
    }

    let cleanName = nombre
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
        console.log('📥 PEDIDO RECIBIDO PARA IMPRIMIR:');
        console.log(JSON.stringify(req.body, null, 2));

        const order = req.body;

        if (!order || !order.items || !order.items.length) {
            return res.status(400).json({
                ok: false,
                message: 'Pedido inválido'
            });
        }

        const cantidadDeBurgers = order.items.filter(it => !it.is_extra).length;
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
                printer.hardware('init')
                    .encode('cp858')
                    .font('A')
                    .size(1, 1)
                    .align('ct')
                    .style('b')
                    .text(order.deliveryHour || '')
                    .feed(1)
                    .font('B')
                    .size(1, 1)
                    .style('b')
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
                    if(!it.is_extra){
                        const mods = [];
                        if (it.extra_cheddar) mods.push('+ch');
                        if (it.extra_bacon) mods.push('+ba')
                        if (it.bbq) mods.push('+bbq');

                        const exclusions = [];
                        if (it.no_salsa) exclusions.push('s/s');
                        if (it.no_cheddar) exclusions.push('s/ch');
                        if (it.no_pepinos) exclusions.push('s/pep');
                        if (it.no_tomate) exclusions.push('s/tom');
                        if (it.no_lechuga) exclusions.push('s/lech');
                        if (it.no_bacon) exclusions.push('s/ba');

                        const unitPrice = (it.total_price / it.quantity);
                        let itemName;

                        if (it.recipe_id) {
                            itemName = buildItemName(it);
                            if (it.extra_papas) itemName += ' + EXTRA PAPAS';
                        } else {
                            itemName = it.name ?? it.nombre ?? '';
                        }

                        for (let i = 0; i < it.quantity; i++) {
                            printer.text(itemName);
                            if (mods.length > 0 || exclusions.length > 0) {
                                printer.text(
                                    `  ${mods.join(' ')} ${exclusions.join(' ')}`
                                );
                            }
                        }
                        printer.feed(1);
                    }
                });

                printer
                    .text('--------------------------------')
                    .align('rt')
                    .style('b')
                    .text(`TOTAL: ${order.total}`)
                    .feed(1);

                if (order.payments.cash > 0) {
                    printer.raw(Buffer.from([0x1D, 0x42, 0x01]))
                        .text('Efectivo: ' + formatCurrencyAR(order.payments.cash))
                        .raw(Buffer.from([0x1D, 0x42, 0x00]))
                        .feed(1);
                }
                if (order.payments.transfer > 0) {
                    printer.text('Tranferencia: ' + formatCurrencyAR(order.payments.transfer))
                        .feed(1);
                }
                if (order.payments.card > 0) {
                    printer.text('Tarjeta: ' + formatCurrencyAR(order.payments.card))
                        .feed(1);
                }

                printer.style('normal')
                    .feed(1)
                    .align('lt')
                    .text(order.date || '')
                    .feed(2)
                    .raw(Buffer.from([0x1B, 0x42, 0x03, 0x02]))
                    .cut();

                if (order.isDelivery) {
                    const cantidadDeBolsas = Math.ceil(cantidadDeBurgers / 2);

                    for (let i = 0; i < cantidadDeBolsas; i++) {
                        printer
                            .feed(3)
                            .font('A')
                            .size(1, 2)
                            .style('b')
                            .align('ct')
                            .text(order.client)
                            .feed(1);

                        if (order.payments.cash > 0) {
                            printer.text('Efectivo: ' + formatCurrencyAR(order.payments.cash));
                        }

                        printer
                            .feed(3)
                            .cut();
                    }
                }

                printer.close();

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

app.get('/impresora/test-print', (req, res) => {
    const device = new escpos.Network(PRINTER_IP, PRINTER_PORT);
    const printer = new escpos.Printer(device);

    device.open((err) => {
        if (err) {
            console.error('❌ Impresora OFFLINE:', err);
            return res.status(500).json({
                ok: false,
                message: 'No se pudo conectar con la impresora'
            });
        }

        try {
            printer
                .hardware('init')
                .align('ct')
                .style('b')
                .text('*** PRUEBA DE IMPRESORA ***')
                .feed(1)
                .text('------------------------------------------------')//48
                .feed(1)
                .font('A')
                .text('----------------------------------------------------------------')//64
                .feed(2)
                .cut()
                .close();

            return res.json({
                ok: true,
                message: 'Impresora OK'
            });
        } catch (e) {
            console.error('❌ Error imprimiendo:', e);
            return res.status(500).json({
                ok: false,
                message: 'Error al imprimir'
            });
        }
    });
});
app.get('/impresora/test', (req, res) => {
    const device = new escpos.Network(PRINTER_IP, PRINTER_PORT);

    device.open((err) => {
        if (err) {
            return res.status(500).json({
                ok: false,
                message: 'Impresora OFFLINE'
            });
        }

        device.close();
        return res.json({
            ok: true,
            message: 'Impresora ONLINE'
        });
    });
});


app.listen(3000, () => {
    console.log('Servidor de Dimas Burgers escuchando en http://localhost:3000');
});