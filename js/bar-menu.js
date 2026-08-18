// A Bit of Bogey — Mt. Paul Bar & Grill menu.
//
// Data and renderer for the "Bar & Grill Menu" screen, reachable from the
// slide-out menu on every topbar. Content is transcribed from the clubhouse's
// printed menu (2026-08-17); layout follows the printed sheet — item name on
// the left, price on the right, italic description underneath — while the
// type, colour and rules come from this app's own design tokens rather than
// the print piece's serif/script faces.
//
// Prices are stored WITHOUT the dollar sign and rendered with one, so a price
// change is a one-token edit and no row can drift into a different format.
//
// A group may set `smallTitle: true` to take the sub-heading treatment instead
// of the poster title — used by the two extras blocks, which read as
// attachments to the section above rather than sections in their own right.
//
// Block types a group can contain:
//   sub    — a coloured sub-heading inside the group ("Lil' Grill")
//   note   — an italic line under a title or sub-heading
//   items  — the standard name/price/description rows
//   pairs  — the two-across grid on the printed sheet. Only Coolers & Ciders
//            still uses it; the two extras sections were flattened to single
//            rows on 2026-08-17 and the type is kept for that one section.
//   draft  — name plus two prices under a Pints/Jugs header
//   text   — a centred run-on line (the sauce lists)

// Departures from the printed sheet, all on Paul's instruction 2026-08-17.
// Recorded here so a future reader comparing this page to the paper menu can
// see the differences are deliberate rather than transcription slips:
//   duplicate "Onions $2.25" row replaced with Salsa | "Liqueres" -> "Liqueurs"
//   "Bogie" -> "Bogey" | "Heyall" -> "Hey Y'all" | "Bud/Coors Lite" -> "Light"
//   "Millers" -> "Miller" | "Sleemans" -> "Sleeman" (x2) | "Motts" -> "Mott's"
//   "Kahlua" -> "Kahlúa" | "jalapenos" -> "jalapeños"
// Left as printed: "Nudes" (Paul could not confirm against the bar; the BC
// brand is Nüdes, parent brand Nude), "Okanagan Springs" (brewery is
// singular but the plural is universal locally), and Forty Creek sitting
// under the liqueurs heading despite being a whisky.
export const BAR_MENU = {
  groups: [
    {
      title: 'Breakfast',
      note: 'Served til 11am M-F — Noon on weekends.',
      blocks: [
        { type: 'sub', label: "Lil' Grill" },
        { type: 'items', items: [
          { name: 'Pancake', price: '4.15', desc: 'Big & fluffy, add Blueberries $1.' },
          { name: "Senior's Deal", price: '6.75', desc: 'Coffee & Cinnamon Bun' },
          { name: 'Bacon Egger', price: '6.75', desc: '1 egg, 2 bacon, & cheddar on an English muffin' },
          { name: 'Hole in One', price: '8.25', desc: '1 egg, 1 pancake, 1 bacon, sausage, or ham' },
          { name: 'Breaky Hash', price: '9.75', desc: 'Sautéed veggies & hash topped with 2 eggs & toast' },
          { name: "Dano's Breaky Wrap", price: '12.50', desc: 'Scrambled eggs, sausage, bacon, veggies, hash, & cheese' },
          { name: '2 Eggs & Toast', price: '6.50' },
          { name: 'Oatmeal', price: '4.25' },
          { name: 'Cinnamon Bun', price: '5.25' }
        ] },
        { type: 'sub', label: 'Big Grill' },
        { type: 'note', text: 'Comes with crispy hash browns & your choice of toast' },
        { type: 'items', items: [
          { name: 'Mt. Paul Breaky Special', price: '11.25', desc: '2 eggs, bacon, sausage, or ham (Served all day)' },
          { name: 'Cheese Omelette', price: '12.75', desc: '3 eggs & 2 cheeses' },
          { name: 'Loaded Omelette', price: '15.25', desc: '3 eggs, 2 cheeses, ham, tomato, onion, mushrooms, & peppers' },
          { name: 'Eggs Benny', price: '15.25', desc: '2 poached eggs, ham, & hollandaise on an English muffin' },
          { name: 'Mop Benny', price: '15.50', desc: '2 poached eggs, sautéed mushrooms, onions, peppers, hollandaise' },
          // Printed sheet reads "Triple Bogie"; corrected 2026-08-17 (Paul).
          { name: 'Triple Bogey', price: '17.50', desc: '3 eggs, 2 meats with bacon, sausage or ham' },
          { name: 'BLT', price: '14.75', desc: '3 bacon, 2 slices of tomato, lettuce & mayo' }
        ] }
      ]
    },
    {
      title: 'Specials',
      blocks: [
        { type: 'items', items: [
          { name: 'Famous Mt Paul Breaky Special', price: '6.00', desc: 'When you tee off before 8 am. Voucher required.' },
          { name: 'Breaky & Bucket Special', price: '19.00', desc: '(Til 11am) Mt Paul Breaky & large Bucket of Balls.' },
          { name: 'Daily Sandwich Special', price: '10.25', desc: 'Choice of soup, salad, or fries.' },
          { name: "Chef's Special", price: '16.50', desc: 'Ask your server' },
          { name: 'Borscht or Soup Special', price: '5.25', desc: 'Ask your server about daily specials.' }
        ] }
      ]
    },
    {
      title: 'Add Extras',
      smallTitle: true,
      blocks: [
        // One row per extra (Paul, 2026-08-17). Order follows the printed
        // sheet read down the left column and then down the right, so the
        // sheet's own grouping survives the flattening.
        { type: 'items', items: [
          { name: '2 Toast', price: '3.25' },
          { name: 'Tomato Slices', price: '3.25' },
          { name: 'Hashbrowns', price: '3.25' },
          { name: '1 Egg', price: '2.00' },
          { name: 'Hollandaise 4oz', price: '4.00' },
          { name: 'Fried Mushroom', price: '4.00' },
          { name: '3 Bacon', price: '3.75' },
          { name: '3 Sausages', price: '3.75' },
          { name: 'Ham Slice', price: '3.75' },
          { name: 'Cheese', price: '3.25' },
          { name: 'Onions', price: '2.25' },
          // Restored 2026-08-17. The current printed sheet lists Onions twice;
          // the 2022 menu PDF shows Salsa in that exact slot (Fried Mushroom
          // $3 | Salsa $2), so the second Onions is a copy error that
          // displaced a real item rather than a duplicated line.
          // PRICE IS INFERRED, NOT SOURCED. 2022 had it at $2.00 and every
          // other row in this block rose $0.25 by the current sheet, so $2.25
          // — the same as the Onions beside it. Confirm at the clubhouse
          // before this page goes to anyone. Tracked in PROJECT.md's Open list.
          { name: 'Salsa', price: '2.25' }
        ] }
      ]
    },
    {
      title: 'Burgers & Sandwiches',
      note: "Choice of soup, salad, or fries. Ask for our 'Gluten Free' options.",
      blocks: [
        { type: 'items', items: [
          { name: 'Buffalo Wrap', price: '14.95', desc: 'Crispy chicken, greens, tomato, cheddar, & hot ranch' },
          { name: 'Chicken Club Wrap', price: '14.95', desc: 'Grilled chicken, bacon, mixed greens, cheese, tomato & mayo' },
          { name: 'Stacked Beef', price: '15.50', desc: 'Slow roasted beef on a grilled hoagie with au jus' },
          { name: 'Clubhouse', price: '15.85', desc: '3 slices bread, 3 bacon, turkey, tomato, lettuce, cheddar, & mayo' },
          { name: 'MP Burger', price: '16.25', desc: 'Hormone free patty, bacon, mushrooms, cheddar, lettuce, & tomato' },
          { name: 'Bistro Burger', price: '13.95', desc: 'Hormone free patty, lettuce, tomato, pickled onion, & burger sauce' },
          { name: 'Beyond Burger', price: '16.50', desc: 'Grilled meatless plant burger, lettuce, tomato, & pickled onion' },
          { name: 'Grilled Chicken Burger', price: '15.25', desc: '5oz Chicken breast, lettuce, pickled onion, tomato' }
        ] }
      ]
    },
    {
      title: 'Add Extras or Substitutions',
      smallTitle: true,
      blocks: [
        { type: 'items', items: [
          { name: 'Side Fries', price: '4.25' },
          { name: 'Side Yam Fries', price: '5.25' },
          { name: 'Side Salad', price: '3.75' },
          { name: 'Side Caesar', price: '5.00' },
          { name: 'Cheddar', price: '3.25' },
          { name: 'Gravy 4oz', price: '4.25' },
          { name: 'Sub Caesar', price: '2.25' },
          { name: 'Sub Beyond', price: '3.25' }
        ] },
        { type: 'sub', label: 'Dips & Salad Dressings' },
        { type: 'note', text: '2 oz portions' },
        // One column rather than the two-across grid used above (Paul,
        // 2026-08-17): Feta Cheese and Guacamole are priced differently from
        // the dips and were reading as their partners' second column.
        { type: 'items', items: [
          { name: 'Dressings', price: '2.25' },
          { name: 'Sauces/Dips', price: '2.25' },
          { name: 'Bun with Butter', price: '2.25' },
          { name: 'Feta Cheese', price: '3.25' },
          { name: 'Guacamole', price: '3.25' }
        ] }
      ]
    },
    {
      title: 'Salad Bowls',
      note: "Includes grilled pita. Ask about our 'Meatless Grilled Vegan' options.",
      blocks: [
        { type: 'items', items: [
          { name: 'Caesar Salad', price: '13.00', desc: 'Romaine, parmesan, house made croutons & dressing' },
          { name: 'Warm Beet Salad', price: '14.25', desc: 'Mixed greens, baked beets, red onion, mandarin, feta, seeds & balsamic' },
          { name: 'Cobb Salad', price: '16.50', desc: 'Mixed greens, cherry tomato, cucumber, bacon, feta & grilled 5oz chicken' },
          { name: 'Warm Cariboo Taco Salad', price: '16.50', desc: 'Crisp romaine, peppers, cherry tomato, beef, parmesan, taco chips' },
          { name: "Nancy's Greek Chicken Salad", price: '16.50', desc: 'Romaine, peppers, tomatoes, onions, olives, feta, chicken' }
        ] }
      ]
    },
    {
      title: 'Appetizers',
      blocks: [
        { type: 'items', items: [
          { name: 'Macho Nacho', price: '18.60', desc: 'Chips heaped with cheese, jalapeños, peppers, tomato, and olives. Includes Sour Cream & Salsa. Add chicken or beef $4. Guacamole $3.' },
          { name: 'Quesadilla', price: '14.00', desc: 'Chicken, peppers, red onion, tomato, two cheeses, in a grilled tortilla with Sour Cream & Salsa.' },
          { name: 'Pound of Wings', price: '15.25', desc: 'Served with veggies & dip & your choice of sauce.' },
          { name: 'Chicken Strips', price: '15.25', desc: '4 pcs served with veggies & dip or fries & your choice of sauce.' },
          { name: 'Chicken Bites', price: '11.75', desc: 'Crispy chicken served on a bed of romaine, green onion, sesame seeds & your choice of sauce.' },
          { name: 'Crispy Ribs', price: '11.75', desc: 'Tasty crisp ribs & your choice of sauce.' },
          { name: 'Grilled Cheese', price: '11.75', desc: 'A classic, comes with salad or fries.' },
          { name: "Kid's Chicken Strips", price: '10.75', desc: '2 pcs served with veggies & dip or fries & your choice of sauce. Substitute for Caesar Salad $2.' },
          { name: "Plain ol' Hot Dog", price: '5.00', desc: "Load 'er up with onions, bacon & cheese $3.75" },
          { name: 'Basket of Fries', price: '5.75', desc: 'Add Cheese & Gravy $4.75' },
          { name: 'Basket of Yam Fries', price: '7.15' },
          { name: 'Basket of Chips & Salsa', price: '5.25' }
        ] },
        { type: 'sub', label: 'Sauces & Dressings' },
        { type: 'text', text: "Thai Chili, Honey Garlic, Poke Sauce, Chipotle Mayo, Frank's Red Hot, Ranch, Caesar, Honey Mustard, BBQ" }
      ]
    },
    {
      title: 'Refreshments',
      blocks: [
        { type: 'items', items: [
          { name: 'Coffee', price: '3.00' },
          { name: 'Tea', price: '2.95' },
          { name: 'Small Orange Juice', price: '3.75' },
          { name: 'Small Apple Juice', price: '3.75' },
          { name: 'Small Milk', price: '2.60' },
          { name: 'Large Milk', price: '3.75' },
          { name: 'Small Chocolate Milk', price: '3.25' },
          { name: 'Large Chocolate Milk', price: '4.25' },
          { name: 'Hot Chocolate with Whip', price: '3.50' },
          { name: 'Soft Drinks on the Gun', price: '2.95' }
        ] }
      ]
    },
    {
      title: 'From the Cooler',
      note: 'Snacks to go, load up before your round of golf.',
      blocks: [
        { type: 'items', items: [
          { name: 'Bottled Water', price: '2.50' },
          { name: 'Gatorade', price: '3.25' },
          { name: 'Bottled Soft Drinks', price: '3.00' },
          { name: 'Chocolate Bars', price: '2.00' },
          { name: 'Potato Chips', price: '2.50' },
          { name: 'Deli Sandwiches', price: '6.25' }
        ] }
      ]
    },
    {
      title: 'Liquor',
      blocks: [
        { type: 'items', items: [
          { name: 'Highballs', price: '6.25', desc: 'Vodka, Gin, Rum, Rye' },
          { name: 'Double Highballs', price: '9.50' },
          { name: 'Big Daddy Caesar', price: '8.75', desc: 'A Mt Paul Special.' },
          { name: 'Double Big Daddy Caesar', price: '11.95' }
        ] },
        // The printed sheet reads "Warmed Liqueres"; corrected to the actual
        // spelling 2026-08-17 (Paul). Forty Creek sitting under a liqueur
        // heading is the club's grouping and stands as printed.
        { type: 'sub', label: 'Warmed Liqueurs' },
        { type: 'items', items: [
          { name: 'Forty Creek', price: '6.25' },
          { name: 'Grand Marnier', price: '6.25' },
          { name: 'Kahlúa', price: '6.25' },
          { name: 'B52 Coffee', price: '8.00', desc: 'With Coffee & Whipped Cream.' }
        ] }
      ]
    },
    {
      title: 'Coolers & Ciders',
      blocks: [
        { type: 'pairs', rows: [
          [{ name: "Hey Y'all", price: '5.95' }, { name: 'Cider', price: '5.95' }],
          [{ name: 'Strongbow', price: '7.55' }, { name: "Mike's Hard", price: '6.25' }],
          [{ name: 'White Claw', price: '6.50' }, { name: 'Nudes', price: '6.25' }]
        ] },
        { type: 'items', items: [
          { name: "Mott's Caesar", price: '7.15' },
          { name: 'Glass of JT', price: '7.45' },
          { name: 'Bottle of JT', price: '23.25' }
        ] }
      ]
    },
    {
      title: 'Beers',
      blocks: [
        { type: 'items', items: [
          { name: 'Domestic', price: '6.15', desc: 'Bud, Bud Light, Canadian, Coors, Coors Light, Kokanee, Pabst Blue Ribbon, Pilsner' },
          { name: 'Imports', price: '6.45', desc: 'Okanagan Springs Pale Ale & 1516, Heineken, Coors Banquet, Miller Genuine Draft, Corona Sleek Can, Sleeman Honey Brown & Clear 2.0.' }
        ] }
      ]
    },
    {
      title: 'Draft on Tap',
      note: 'Add Clamato $0.75',
      blocks: [
        { type: 'draft', head: ['Pints', 'Jugs'], items: [
          { name: 'Budweiser', prices: ['6.65', '20.85'] },
          { name: 'Okanagan Springs 1516', prices: ['6.65', '20.85'] },
          { name: 'Sleeman Honey Brown', prices: ['6.65', '20.85'] },
          { name: 'Red Collar IPA', prices: ['6.90', '21.25'] }
        ] }
      ]
    }
  ]
};

// --- Rendering ---------------------------------------------------------

// Menu copy is authored in this file, not user input, but it still goes
// through the same escape on its way into innerHTML — an ampersand in
// "Burgers & Sandwiches" or "Chips & Salsa" is otherwise an invalid entity
// waiting to happen, and a future price edit shouldn't have to think about it.
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function money(p) {
  return '$' + p;
}

function itemsHTML(items) {
  return items.map((it) => `
      <div class="bgm-row">
        <span class="bgm-name">${esc(it.name)}</span>
        <span class="bgm-dots"></span>
        <span class="bgm-price">${money(esc(it.price))}</span>
      </div>
      ${it.desc ? `<p class="bgm-desc">${esc(it.desc)}</p>` : ''}`).join('');
}

function pairsHTML(rows) {
  return `<div class="bgm-pairs">${rows.map((row) => row.map((cell) => cell
    ? `<span class="bgm-pair-name">${esc(cell.name)}</span><span class="bgm-pair-price">${money(esc(cell.price))}</span>`
    : '<span></span><span></span>').join('')).join('')}</div>`;
}

function draftHTML(block) {
  return `
    <div class="bgm-draft-head">
      <span></span>
      <span>${esc(block.head[0])}</span>
      <span>${esc(block.head[1])}</span>
    </div>
    ${block.items.map((it) => `
    <div class="bgm-draft-row">
      <span class="bgm-name">${esc(it.name)}</span>
      <span class="bgm-price">${money(esc(it.prices[0]))}</span>
      <span class="bgm-price">${money(esc(it.prices[1]))}</span>
    </div>`).join('')}`;
}

function blockHTML(block) {
  switch (block.type) {
    case 'sub':   return `<h3 class="bgm-sub">${esc(block.label)}</h3>`;
    case 'note':  return `<p class="bgm-note">${esc(block.text)}</p>`;
    case 'items': return itemsHTML(block.items);
    case 'pairs': return pairsHTML(block.rows);
    case 'draft': return draftHTML(block);
    case 'text':  return `<p class="bgm-runon">${esc(block.text)}</p>`;
    default:      return '';
  }
}

// Returns the menu body only — the caller supplies the screen wrapper, topbar
// and the Home button, the same way renderReports() composes its own page.
export function barMenuHTML() {
  return BAR_MENU.groups.map((g) => `
    <section class="bgm-group">
      <h2 class="bgm-title${g.smallTitle ? ' bgm-title-sm' : ''}">${esc(g.title)}</h2>
      ${g.note ? `<p class="bgm-note">${esc(g.note)}</p>` : ''}
      ${g.blocks.map(blockHTML).join('')}
    </section>`).join('');
}
