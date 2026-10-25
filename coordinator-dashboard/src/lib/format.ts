// "1 bottle" reads better than "1 bottles" in a summary someone is about to
// act on. Units are free text, so singularise the common plural form only.
export function quantityLabel(quantity: number, unit: string | null): string {
  if (unit) {
    return `${quantity} ${quantity === 1 && unit.endsWith('s') ? unit.slice(0, -1) : unit}`;
  }
  return `${quantity} ${quantity === 1 ? 'unit' : 'units'}`;
}
