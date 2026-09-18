/**
 * How numbers are written on screen. These sit outside the components because
 * the shell and the pages of a plan both count things, and a plan that says
 * "1 plans" in one corner and "1 plan" in another reads as a bug.
 */

export function money(value: number, currency: string, compact = false) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    maximumFractionDigits: compact ? 1 : 0,
    notation: compact ? "compact" : "standard",
  }).format(value);
}

/** Per-kilogram prices need their cents: rounding $3.50 to "$4" is not a price. */
export function rate(value: number, currency: string) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function number(value: number, digits = 1) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: digits }).format(value);
}

export function plural(count: number, noun: string, many = noun + "s") {
  return `${number(count, 0)} ${count === 1 ? noun : many}`;
}
