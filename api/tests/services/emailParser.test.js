jest.mock('../../src/services/ai', () => ({
  complete: jest.fn(),
  completeWithImage: jest.fn(),
}));

const { complete } = require('../../src/services/ai');
const {
  parseEmailExpense,
  classifyEmailExpense,
  deriveEmailReceiptFamily,
  heuristicDisposition,
  selectRelevantEmailText,
  extractFallbackItemsFromEmailBody,
  summarizeStructuredItemBlock,
  analyzeEmailSignals,
  classifyEmailModality,
  extractEmailLocationCandidate,
  clampExpenseDate,
} = require('../../src/services/emailParser');

describe('emailParser', () => {
  beforeEach(() => complete.mockReset());

  it('returns parsed expense from receipt email', async () => {
    complete.mockResolvedValue('{"merchant":"Amazon","amount":29.99,"date":"2026-03-21","notes":"Order #123"}');
    const result = await parseEmailExpense('Your order total: $29.99', 'Order Confirmation', 'orders@amazon.com', '2026-03-21');
    expect(result).toEqual({
      merchant: 'Amazon',
      amount: 29.99,
      date: '2026-03-21',
      notes: 'Order #123',
      payment_method: null,
      card_label: null,
      card_last4: null,
      items: null,
    });
  });

  it('returns null for non-receipt emails', async () => {
    complete.mockResolvedValue('null');
    const result = await parseEmailExpense('Hi, how are you?', 'Hey', 'friend@example.com', '2026-03-21');
    expect(result).toBeNull();
  });

  it('returns null on invalid JSON', async () => {
    complete.mockResolvedValue('not json');
    const result = await parseEmailExpense('body', 'subject', 'from@test.com', '2026-03-21');
    expect(result).toBeNull();
  });

  it('classifies obvious shipping-only emails without an LLM call', async () => {
    const result = await classifyEmailExpense(
      'Your package is out for delivery. Track your shipment here.',
      'Delivery update',
      'tracking@ups.com',
      '2026-03-21'
    );
    expect(result).toEqual({
      disposition: 'not_expense',
      merchant: null,
      reason: 'heuristic_skip',
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it('classifies purchase emails with the classifier prompt', async () => {
    complete.mockResolvedValue('{"disposition":"expense","merchant":"Amazon","reason":"order receipt"}');
    const result = await classifyEmailExpense(
      'Order total: $29.99',
      'Amazon order',
      'orders@amazon.com',
      '2026-03-21'
    );
    expect(result).toEqual({
      disposition: 'expense',
      merchant: 'Amazon',
      reason: 'order receipt',
    });
  });

  it('heuristicDisposition only flags clear non-expense emails', () => {
    expect(heuristicDisposition('Delivery update', 'tracking@ups.com', 'Track your package')).toBe('not_expense');
    expect(heuristicDisposition('Order confirmation', 'orders@amazon.com', 'Order total: $20.00')).toBeNull();
  });

  it('treats transaction-like money signals as review-worthy even when the email is noisy', () => {
    const signals = analyzeEmailSignals(
      'Your booking is confirmed',
      'receipts@booking.com',
      'View in browser. Reservation details below. Total charged: $184.22. Manage preferences.'
    );
    expect(signals.strongMoneySignal).toBe(true);
    expect(signals.shouldSurfaceToReview).toBe(true);
    expect(heuristicDisposition(
      'Your booking is confirmed',
      'receipts@booking.com',
      'View in browser. Reservation details below. Total charged: $184.22. Manage preferences.'
    )).toBeNull();
  });

  it('treats Uber and Lyft senders as transactional when ride context is present', () => {
    const uberSignals = analyzeEmailSignals(
      'Your ride with Uber',
      'uber.us@uber.com',
      'Trip total: $18.42'
    );
    const lyftSignals = analyzeEmailSignals(
      'Thanks for riding with Lyft',
      'receipt@lyftmail.com',
      'Ride receipt total $24.18'
    );
    expect(uberSignals.senderLooksTransactional).toBe(true);
    expect(uberSignals.shouldSurfaceToReview).toBe(true);
    expect(lyftSignals.senderLooksTransactional).toBe(true);
    expect(lyftSignals.shouldSurfaceToReview).toBe(true);
  });

  it('derives receipt families for grocery, travel, and ride emails', () => {
    expect(deriveEmailReceiptFamily(
      'Your Whole Foods receipt',
      'auto-confirm@wholefoods.com',
      'Items Purchased: 6\nQty: 1 @ $2.59 each\nTotal $19.84'
    )).toBe('grocery_receipt');
    expect(deriveEmailReceiptFamily(
      'Your stay is confirmed',
      'reservations@hilton.com',
      'Check-in Saturday, May 16, 2026\nGuest name: Dang'
    )).toBe('travel_receipt');
    expect(deriveEmailReceiptFamily(
      'Thanks for riding with Lyft',
      'receipt@lyftmail.com',
      'Ride receipt total $24.18'
    )).toBe('ride_receipt');
  });

  it('throws when emailBody is empty', async () => {
    await expect(parseEmailExpense('', 'sub', 'from@test.com', '2026-03-21')).rejects.toThrow('emailBody is required');
  });

  it('throws when todayDate is invalid', async () => {
    await expect(parseEmailExpense('body', 'sub', 'from@test.com', 'bad-date')).rejects.toThrow('todayDate must be');
  });

  it('truncates very long email bodies', async () => {
    complete.mockResolvedValue('null');
    const longBody = 'x'.repeat(5000);
    await parseEmailExpense(longBody, 'sub', 'from@test.com', '2026-03-21');
    const calledWith = complete.mock.calls[0][0];
    expect(calledWith.messages[0].content.length).toBeLessThan(4600);
  });

  it('includes the snippet in relevant email text selection', () => {
    const result = selectRelevantEmailText('Body with order total $19.00', 'Snippet with merchant');
    expect(result.classifierText).toContain('Snippet with merchant');
    expect(result.extractionText).toContain('Snippet with merchant');
  });

  it('preserves line structure in extraction text for itemized emails', () => {
    const emailBody = `Order summary
Subtotal (4 items)
Protein Bars
Sparkling Water
Estimated shipping
Estimated tax
Estimated total
$22.00
$14.99
$8.49
$0.00
$1.20
$24.19`;
    const result = selectRelevantEmailText(emailBody, 'Estimated total $24.19');
    expect(result.extractionText).toContain('Protein Bars\nSparkling Water');
    expect(result.extractionText).toContain('Estimated total\n$22.00');
  });

  it('preserves bottom receipt totals when they appear later in the email', () => {
    const emailBody = `Thanks for your order
Marketing banner
Recommended items
Still shopping?
---
Order summary
Protein Bars
Sparkling Water
Shipping
Tax
Grand total
$14.99
$8.49
$0.00
$1.20
$24.68`;
    const result = selectRelevantEmailText(emailBody, 'Grand total $24.68');
    expect(result.classifierText).toContain('Grand total');
    expect(result.classifierText).toContain('$24.68');
    expect(result.extractionText).toContain('Grand total');
    expect(result.extractionText).toContain('$24.68');
  });

  it('keeps likely item rows alongside total lines in extraction text', () => {
    const emailBody = `Order summary
Nike running shoes
Water bottle
Discount
Estimated total
$122.24`;
    const result = selectRelevantEmailText(emailBody, 'Estimated total $122.24');
    expect(result.extractionText).toContain('Nike running shoes');
    expect(result.extractionText).toContain('Water bottle');
    expect(result.extractionText).toContain('Estimated total\n$122.24');
  });

  it('preserves item card blocks with brand, sku, quantity, and price for rich order emails', () => {
    const emailBody = `SHIPPING ADDRESS
Dang Nguyen
1546 Audubon Village Dr
Winston Salem, NC 27106

ITEM DESCRIPTION
DAK - Plum Marmalade
Espresso
DAK Coffee Roasters
COF-DA-0323
x 1
$19.99

DAK - House of Plum Espresso
DAK Coffee Roasters
COF-DA-0397
x 1
$21.99

DAK - Cream Donut Espresso
DAK Coffee Roasters
COF-DA-0377
x 1
$29.99

September - Peanut Brittle Espresso
September Coffee Co
COF-SP-0128
x 1
$16.99

DAK - Jazz Fruits Espresso
DAK Coffee Roasters
COF-DA-0061
x 1
$18.99

Subtotal
$107.95
Total
$107.95`;
    const result = selectRelevantEmailText(emailBody, 'Total $107.95');
    expect(result.extractionText).toContain('DAK - Plum Marmalade');
    expect(result.extractionText).toContain('DAK Coffee Roasters');
    expect(result.extractionText).toContain('COF-DA-0323');
    expect(result.extractionText).toContain('x 1');
    expect(result.extractionText).toContain('$19.99');
    expect(result.extractionText).toContain('September - Peanut Brittle Espresso');
    expect(result.extractionText).toContain('$16.99');
    expect(result.extractionText).toContain('Total\n$107.95');
  });

  it('extracts fallback product items directly from rich email body structure', () => {
    const emailBody = `ITEM DESCRIPTION
DAK - Plum Marmalade
Espresso
DAK Coffee Roasters
COF-DA-0323
x 1
$19.99

DAK - House of Plum Espresso
DAK Coffee Roasters
COF-DA-0397
x 1
$21.99

Subtotal
$41.98
Total
$41.98`;

    const items = extractFallbackItemsFromEmailBody(emailBody);
    expect(items).toEqual([
      expect.objectContaining({
        description: 'DAK - Plum Marmalade Espresso',
        amount: 19.99,
        quantity: 1,
        unit_price: 19.99,
        brand: 'DAK Coffee Roasters',
        sku: 'COF-DA-0323',
      }),
      expect.objectContaining({
        description: 'DAK - House of Plum Espresso',
        amount: 21.99,
        quantity: 1,
        unit_price: 21.99,
        brand: 'DAK Coffee Roasters',
        sku: 'COF-DA-0397',
      }),
    ]);
  });

  it('captures quantity and each price from item-card grocery email blocks', () => {
    const emailBody = `Items Purchased: 2
365 by Whole Foods Market Organic Lasagne, 16 OZ
Qty: 3 @ $1.79 each
$5.37

OLIPOP Crisp Apple Prebiotic Soda, 12 FZ
Qty: 1 @ $2.59 each
$2.59

Total
$7.96`;

    const items = extractFallbackItemsFromEmailBody(emailBody);
    expect(items).toEqual([
      expect.objectContaining({
        description: '365 by Whole Foods Market Organic Lasagne, 16 OZ',
        amount: 5.37,
        quantity: 3,
        unit_price: 1.79,
      }),
      expect.objectContaining({
        description: 'OLIPOP Crisp Apple Prebiotic Soda, 12 FZ',
        amount: 2.59,
        quantity: 1,
        unit_price: 2.59,
      }),
    ]);
  });

  it('does not use fallback item extraction for travel-style reservation emails', () => {
    const emailBody = `Confirmed: your trip to Charlotte
Check-out: Saturday, May 16, 2026
Room 1 Guest Name:
Cancellation policy deadlines are in 24-hour clock format, unless otherwise stated.
Start your day sooner with 12pm check-in, when available Room Upgrade
Keep your vacation going with guaranteed 4pm check-out Cost & Billing
For more information, please visit americanexpress.com/travelterms .
Total
$550.00`;
    expect(extractFallbackItemsFromEmailBody(emailBody, 'travel_receipt')).toEqual([]);
  });

  it('filters parsed ride and travel pseudo-items that are not real charges', async () => {
    complete.mockResolvedValue(JSON.stringify({
      merchant: 'Hilton',
      amount: 184.22,
      date: '2026-05-16',
      notes: 'Imported from Gmail',
      items: [
        { description: 'Check-out: Saturday, May 16, 2026', amount: 1.0 },
        { description: 'Room rate', amount: 160.0 },
        { description: 'Taxes and fees', amount: 24.22 },
      ],
    }));

    const result = await parseEmailExpense(
      'Check-out: Saturday, May 16, 2026\nRoom rate\n$160.00\nTaxes and fees\n$24.22\nTotal\n$184.22',
      'Your stay receipt',
      'reservations@hilton.com',
      '2026-05-16'
    );

    expect(result.items).toEqual([
      expect.objectContaining({ description: 'Room rate' }),
      expect.objectContaining({ description: 'Taxes and fees' }),
    ]);
  });

  it('uses fallback items when the model only returns summary rows', async () => {
    complete.mockResolvedValue(`{
      "merchant":"Coffee Order",
      "amount":107.95,
      "date":"2026-04-21",
      "notes":"Imported from Gmail",
      "items":[
        { "description":"Subtotal", "amount":107.95, "upc":null, "sku":null, "brand":null, "product_size":null, "pack_size":null, "unit":null }
      ]
    }`);

    const result = await parseEmailExpense(
      `ITEM DESCRIPTION
DAK - Plum Marmalade
Espresso
DAK Coffee Roasters
COF-DA-0323
x 1
$19.99

DAK - House of Plum Espresso
DAK Coffee Roasters
COF-DA-0397
x 1
$21.99

Subtotal
$41.98
Total
$41.98`,
      'Coffee order',
      'orders@example.com',
      '2026-04-21'
    );

    expect(result.items).toEqual([
      expect.objectContaining({ description: 'DAK - Plum Marmalade Espresso', amount: 19.99 }),
      expect.objectContaining({ description: 'DAK - House of Plum Espresso', amount: 21.99 }),
    ]);
  });

  it('uses fallback items when the model only returns fee and summary rows', async () => {
    complete.mockResolvedValue(`{
      "merchant":"Eight Ounce Coffee",
      "amount":107.95,
      "date":"2026-04-21",
      "notes":"Imported from Gmail",
      "items":[
        { "description":"Subtotal", "amount":18.99, "upc":null, "sku":null, "brand":null, "product_size":null, "pack_size":null, "unit":null },
        { "description":"shipping and taxes", "amount":88.96, "upc":null, "sku":null, "brand":null, "product_size":null, "pack_size":null, "unit":null }
      ]
    }`);

    const result = await parseEmailExpense(
      `Item Description
DAK - Plum Marmalade Espresso
DAK Coffee Roasters
COF-DA-0323
x 1
$19.99

DAK - House of Plum Espresso
DAK Coffee Roasters
COF-DA-0397
x 1
$21.99

DAK - Cream Donut Espresso
DAK Coffee Roasters
COF-DA-0377
x 1
$29.99

September - Peanut Brittle Espresso
September Coffee Co
COF-SP-0128
x 1
$16.99

DAK - Jazz Fruits Espresso
DAK Coffee Roasters
COF-DA-0061
x 1
$18.99

Subtotal
$107.95
Total
$107.95`,
      'Order #RT-270233 confirmed',
      'hello@eightouncecoffee.ca',
      '2026-04-21'
    );

    expect(result.items).toEqual([
      expect.objectContaining({ description: 'DAK - Plum Marmalade Espresso', amount: 19.99 }),
      expect.objectContaining({ description: 'DAK - House of Plum Espresso', amount: 21.99 }),
      expect.objectContaining({ description: 'DAK - Cream Donut Espresso', amount: 29.99 }),
      expect.objectContaining({ description: 'September - Peanut Brittle Espresso', amount: 16.99 }),
      expect.objectContaining({ description: 'DAK - Jazz Fruits Espresso', amount: 18.99 }),
    ]);
  });

  it('detects a strong structured item block when item rows are clearly present', () => {
    expect(summarizeStructuredItemBlock(
      `Item Description
DAK - Plum Marmalade Espresso
DAK Coffee Roasters
COF-DA-0323
x 1
$19.99

DAK - House of Plum Espresso
DAK Coffee Roasters
COF-DA-0397
x 1
$21.99

Subtotal
$41.98`
    )).toEqual(expect.objectContaining({
      level: 'strong',
      deterministic_item_count: 2,
      has_anchor_label: true,
    }));
  });

  it('does not extract travel itinerary and policy lines as fallback items', () => {
    const emailBody = `Confirmed: your trip to Charlotte
$96.00
Check-out: Saturday, May 16, 2026
$1.00
Room 1 Guest Name:
$2.00
Cancellation policy deadlines are in 24-hour clock format, unless otherwise stated.
$550.00
Start your day sooner with 12pm check-in, when available Room Upgrade
$100.00
Keep your vacation going with guaranteed 4pm check-out Cost & Billing
$429.00
Dollars used:
$494.42
For more information, please visit americanexpress.com/travelterms .
$100.00`;

    expect(extractFallbackItemsFromEmailBody(emailBody)).toEqual([]);
  });

  it('filters clearly informational travel rows from parsed items', async () => {
    complete.mockResolvedValue(`{
      "merchant":"Amex Travel",
      "amount":96.00,
      "date":"2026-04-21",
      "notes":"Imported from Gmail",
      "items":[
        { "description":"Confirmed: your trip to Charlotte", "amount":96.00, "upc":null, "sku":null, "brand":null, "product_size":null, "pack_size":null, "unit":null },
        { "description":"Check-out: Saturday, May 16, 2026", "amount":1.00, "upc":null, "sku":null, "brand":null, "product_size":null, "pack_size":null, "unit":null },
        { "description":"Cancellation policy deadlines are in 24-hour clock format, unless otherwise stated.", "amount":550.00, "upc":null, "sku":null, "brand":null, "product_size":null, "pack_size":null, "unit":null }
      ]
    }`);

    const result = await parseEmailExpense(
      `Confirmed: your trip to Charlotte
Total charged: $96.00`,
      'Your trip is confirmed',
      'travel@americanexpress.com',
      '2026-04-21'
    );

    expect(result.items).toBeNull();
  });

  it('extracts whole foods style purchased items from qty and each-price rows', () => {
    const emailBody = `April 27, 2026
Whole Foods Market - Winston-Salem
Order # 113-8680173-4268209
Transaction Id KFKJW1HV3I
Payment Method(s)
American Express *9749
$19.84

Subtotal
$20.94
Total Savings
-$1.61
Sales Tax
$0.51
Total
$19.84

How was your trip?
Provide Feedback

Items Purchased: 6
365 by Whole Foods Market Organic Lasagne,
16 OZ
Qty: 3 @ $1.79 each
$5.37

OLIPOP Crisp Apple Prebiotic Soda, 12 FZ
Qty: 1 @ $2.59 each
$2.59

365 by Whole Foods Market Organic Feta
Crumbles, 4 OZ
Qty: 1 @ $4.99 each
$4.99

VAN LEEUWEN Earl Grey Ice Cream, 14 FZ
Qty: 1 @ $7.99 each
$6.38
$1.61 promotions applied

View All Items`;

    expect(extractFallbackItemsFromEmailBody(emailBody)).toEqual([
      expect.objectContaining({
        description: '365 by Whole Foods Market Organic Lasagne, 16 OZ',
        amount: 5.37,
        quantity: 3,
        unit_price: 1.79,
      }),
      expect.objectContaining({
        description: 'OLIPOP Crisp Apple Prebiotic Soda, 12 FZ',
        amount: 2.59,
        quantity: 1,
        unit_price: 2.59,
      }),
      expect.objectContaining({
        description: '365 by Whole Foods Market Organic Feta Crumbles, 4 OZ',
        amount: 4.99,
        quantity: 1,
        unit_price: 4.99,
      }),
      expect.objectContaining({
        description: 'VAN LEEUWEN Earl Grey Ice Cream, 14 FZ',
        amount: 6.38,
        quantity: 1,
        unit_price: 7.99,
      }),
    ]);
  });

  it('prefers extracted grocery items over corrupted parsed header rows', async () => {
    complete.mockResolvedValue(`{
      "merchant":"Whole Foods Market",
      "amount":19.84,
      "date":"2026-04-27",
      "notes":"Imported from Gmail",
      "payment_method":"credit",
      "card_label":"American Express",
      "card_last4":"9749",
      "items":[
        { "description":"April 27, 2026 Order # 113-8680173-4268209", "amount":9749.00, "upc":null, "sku":null, "brand":null, "product_size":null, "pack_size":null, "unit":null },
        { "description":"How was your trip? Provide Feedback", "amount":3.00, "upc":null, "sku":null, "brand":null, "product_size":null, "pack_size":null, "unit":null },
        { "description":"OLIPOP Crisp Apple Prebiotic Soda, 12 FZ", "amount":1.00, "upc":null, "sku":null, "brand":null, "product_size":null, "pack_size":null, "unit":null },
        { "description":"VAN LEEUWEN Earl Grey Ice Cream, 14 FZ", "amount":1.00, "upc":null, "sku":null, "brand":null, "product_size":null, "pack_size":null, "unit":null }
      ]
    }`);

    const result = await parseEmailExpense(
      `April 27, 2026
Whole Foods Market - Winston-Salem
Order # 113-8680173-4268209
Transaction Id KFKJW1HV3I
Payment Method(s)
American Express *9749
$19.84

Subtotal
$20.94
Total Savings
-$1.61
Sales Tax
$0.51
Total
$19.84

How was your trip?
Provide Feedback

Items Purchased: 6
365 by Whole Foods Market Organic Lasagne,
16 OZ
Qty: 3 @ $1.79 each
$5.37

OLIPOP Crisp Apple Prebiotic Soda, 12 FZ
Qty: 1 @ $2.59 each
$2.59

365 by Whole Foods Market Organic Feta
Crumbles, 4 OZ
Qty: 1 @ $4.99 each
$4.99

VAN LEEUWEN Earl Grey Ice Cream, 14 FZ
Qty: 1 @ $7.99 each
$6.38
$1.61 promotions applied

View All Items`,
      'Whole Foods receipt',
      'orders@wholefoodsmarket.com',
      '2026-04-27'
    );

    expect(result.items).toEqual([
      expect.objectContaining({ description: '365 by Whole Foods Market Organic Lasagne, 16 OZ', amount: 5.37 }),
      expect.objectContaining({ description: 'OLIPOP Crisp Apple Prebiotic Soda, 12 FZ', amount: 2.59 }),
      expect.objectContaining({ description: '365 by Whole Foods Market Organic Feta Crumbles, 4 OZ', amount: 4.99 }),
      expect.objectContaining({ description: 'VAN LEEUWEN Earl Grey Ice Cream, 14 FZ', amount: 6.38 }),
    ]);
  });

  it('overrides corrupted parsed totals when the email has a clean explicit total', async () => {
    complete.mockResolvedValue(`{
      "merchant":"Whole Foods Market",
      "amount":9749,
      "date":"2026-04-27",
      "notes":"Imported from Gmail",
      "payment_method":"credit",
      "card_label":"American Express",
      "card_last4":"9749",
      "items":[
        { "description":"OLIPOP Crisp Apple Prebiotic Soda, 12 FZ", "amount":1.00, "upc":null, "sku":null, "brand":null, "product_size":null, "pack_size":null, "unit":null }
      ]
    }`);

    const result = await parseEmailExpense(
      `April 27, 2026
Whole Foods Market - Winston-Salem
Payment Method(s)
American Express *9749

Subtotal
$20.94
Total Savings
-$1.61
Sales Tax
$0.51
Total
$19.84`,
      'Whole Foods receipt',
      'orders@wholefoodsmarket.com',
      '2026-04-27'
    );

    expect(result.amount).toBe(19.84);
    expect(result.card_last4).toBe('9749');
  });

  it('overrides savings-like parsed amounts when the email has a clean explicit total', async () => {
    complete.mockResolvedValue(`{
      "merchant":"Whole Foods Market",
      "amount":1.61,
      "date":"2026-04-27",
      "notes":"Imported from Gmail",
      "payment_method":"credit",
      "card_label":"American Express",
      "card_last4":"9749",
      "items":[
        { "description":"VAN LEEUWEN Earl Grey Ice Cream, 14 FZ", "amount":6.38, "upc":null, "sku":null, "brand":null, "product_size":null, "pack_size":null, "unit":null }
      ]
    }`);

    const result = await parseEmailExpense(
      `April 27, 2026
Whole Foods Market - Winston-Salem
Payment Method(s)
American Express *9749

Subtotal
$20.94
Total Savings
-$1.61
Sales Tax
$0.51
Total
$19.84

$1.61 promotions applied`,
      'Whole Foods receipt',
      'orders@wholefoodsmarket.com',
      '2026-04-27'
    );

    expect(result.amount).toBe(19.84);
  });

  it('finds the explicit total even when summary amounts are collapsed onto one line', async () => {
    complete.mockResolvedValue(`{
      "merchant":"Whole Foods Market",
      "amount":1.61,
      "date":"2026-04-27",
      "notes":"Imported from Gmail",
      "payment_method":"credit",
      "card_label":"American Express",
      "card_last4":"9749",
      "items":null
    }`);

    const result = await parseEmailExpense(
      'Whole Foods Market - Winston-Salem Subtotal $20.94 Total Savings -$1.61 Sales Tax $0.51 Total $19.84 $1.61 promotions applied',
      'Whole Foods receipt',
      'orders@wholefoodsmarket.com',
      '2026-04-27'
    );

    expect(result.amount).toBe(19.84);
  });

  it('sends structured extraction text to the parser prompt', async () => {
    complete.mockResolvedValue('null');
    await parseEmailExpense(
      `Order summary
Protein Bars
Sparkling Water
Estimated total
$24.19`,
      'Order Confirmation',
      'orders@example.com',
      '2026-03-21'
    );
    const calledWith = complete.mock.calls[0][0];
    expect(calledWith.messages[0].content).toContain('Protein Bars\nSparkling Water');
    expect(calledWith.messages[0].content).toContain('Estimated total\n$24.19');
  });

  it('clamps future parsed dates to the latest allowed charge date', () => {
    expect(clampExpenseDate('2026-04-07', '2026-04-03')).toBe('2026-04-03');
    expect(clampExpenseDate('2026-04-01', '2026-04-03')).toBe('2026-04-01');
    expect(clampExpenseDate(null, '2026-04-03')).toBe('2026-04-03');
  });

  it('classifies in-person receipt emails separately from online orders', () => {
    expect(classifyEmailModality(
      'Your receipt from Trader Joe\'s',
      'receipts@traderjoes.com',
      'Thanks for shopping with us today. Store #104. 123 Main St, Brooklyn, NY 11201.'
    )).toBe('in_person');

    expect(classifyEmailModality(
      'Order confirmation',
      'orders@amazon.com',
      'Your order has been placed. Estimated delivery April 7. Track your package.'
    )).toBe('delivery');
  });

  it('extracts a candidate location from in-person receipt text', () => {
    expect(extractEmailLocationCandidate(
      'Your receipt from Trader Joe\'s',
      'receipts@traderjoes.com',
      'Store #104. 123 Main St, Brooklyn, NY 11201.'
    )).toEqual({
      address: '123 Main St, Brooklyn, NY 11201',
      city_state: 'Brooklyn, NY 11201',
      store_number: '104',
    });
  });
});
