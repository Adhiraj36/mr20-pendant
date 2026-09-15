/** ₹5,999 — Indian grouping, no decimals; nothing here has paise. */
export function money(amount: number): string {
  return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(amount)}`
}
/** ₹1,500 / month, with a non-breaking space before the slash. */
export function monthly(amount: number): string {
  return `${money(amount)} / month`
}
