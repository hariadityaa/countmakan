// Line icons for meals without a photo. Picked by keywords in the item names.
// Drawn on a 24px grid in the same stroke style as the nav icons.

const KINDS = [
  ['drink', /\b(kopi|teh|coffee|tea|latte|cappuccino|americano|espresso|mocha|milo|horlicks|bandung|juice|smoothie|milk ?shake|bubble tea|boba|soda|cola|coke|beer|wine|water)\b/],
  ['dessert', /\b(cakes?|kueh|kuih|ice cream|ice kacang|chendol|cendol|desserts?|puddings?|tarts?|brownies?|waffles?|donuts?|doughnuts?|chocolates?|tau huay|bubur cha cha)\b/],
  ['noodles', /\b(mee|mian|noodles?|laksa|pho|ramen|udon|soba|kway teow|kuey teow|bee hoon|beehoon|mee hoon|hor fun|pad thai|pasta|spaghetti|macaroni|lasagna)\b/],
  ['rice', /\b(rice|nasi|biryani|briyani|porridge|congee|bubur|risotto|claypot)\b/],
  ['egg', /\b(eggs?|omelett?es?|telur)\b/],
  ['bread', /\b(bread|toast|roti|prata|sandwich(es)?|buns?|pau|bao|naan|chapati|croissants?|burgers?|bagels?)\b/],
  ['fruit', /\b(fruits?|apples?|bananas?|oranges?|mangos?|mangoes|durian|papaya|watermelon|grapes?|pears?|berry|berries|kiwi|pineapple)\b/],
  ['snack', /\b(crackers?|biscuits?|cookies?|chips|crisps|nuts|peanuts|almonds|popcorn|snacks?|pretzels?)\b/],
];

const PATHS = {
  drink: '<path d="M6 8h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M17 10h1.5a2 2 0 0 1 0 4H17"/><path d="M9 3c0 1.5 1 1.5 1 3M13 3c0 1.5 1 1.5 1 3"/>',
  dessert: '<path d="M4 20h16v-8L4 16z"/><path d="M4 18h16"/><circle cx="17" cy="8.5" r="1.5"/>',
  noodles: '<path d="M4 12h16a8 8 0 0 1-16 0z"/><path d="M9 12V4M13 12V3"/><path d="M7 9c2 1 4-1 6 0s3 0 4-.5"/>',
  rice: '<path d="M4 11h16a8 8 0 0 1-16 0z"/><path d="M7 11c0-3 2-5 5-5s5 2 5 5"/>',
  egg: '<path d="M12 3c-4 0-7 6-7 10a7 7 0 0 0 14 0c0-4-3-10-7-10z"/>',
  bread: '<path d="M5.5 20v-9.5A3.5 3.5 0 0 1 7.5 4h9a3.5 3.5 0 0 1 2 6.5V20z"/>',
  fruit: '<path d="M12 7.5c-2-1.5-7-1-7 4.5 0 4 3 8 5 8 1 0 1.3-.5 2-.5s1 .5 2 .5c2 0 5-4 5-8 0-5.5-5-6-7-4.5z"/><path d="M12 7.5c0-2 1-3.5 3-4.5"/>',
  snack: '<path d="M20 12.5A8 8 0 1 1 11.5 4a3 3 0 0 0 4 3.5 3 3 0 0 0 4.5 5z"/><path d="M9 10h.01M13.5 15h.01M8.5 15h.01M15 11.5h.01"/>',
  plate: '<circle cx="12" cy="12" r="5.5"/><path d="M3 4v4.5a1.5 1.5 0 0 0 3 0V4M4.5 10v10M21 4c-1.5 0-2.5 2-2.5 5.5H21M21 4v16"/>',
};

// Checks the biggest items first, then the typed text. Falls back to a plate.
export function foodKind(items, text = '') {
  const names = [...(items || [])]
    .sort((a, b) => (Number(b.kcal) || 0) - (Number(a.kcal) || 0))
    .map((i) => String(i?.name || ''));
  for (const s of [...names, String(text || '')]) {
    const hay = s.toLowerCase();
    const hit = KINDS.find(([, re]) => re.test(hay));
    if (hit) return hit[0];
  }
  return 'plate';
}

export function foodIconSvg(items, text) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${PATHS[foodKind(items, text)]}</svg>`;
}
