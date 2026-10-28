// Phone numbers arrive with the separators people actually type — "+91 98765
// 43210", "98765-43210", "(044) 2345 6789". Users.phone and Aid_Requests.phone
// are VARCHAR(15), and the portal's phone field caps input at 15 characters, so
// counting separators against that limit rejected or silently truncated
// legitimate numbers.
//
// Normalising on the way in also makes stored numbers comparable: "+91 98765
// 43210" and "+919876543210" are the same person, so they have to be one value,
// or the unique index on Users.phone stops meaning what it says.
const SEPARATORS = /[\s\-().]/g;

// Digits and a leading "+" only. Anything that is not a string normalises to '',
// which every caller already treats as "missing".
function normalisePhone(value) {
  if (typeof value !== 'string') return '';
  return value.replace(SEPARATORS, '');
}

module.exports = { normalisePhone };
