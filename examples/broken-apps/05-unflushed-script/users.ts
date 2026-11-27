export interface Visitor {
  id: string;
  country: string;
}

const COUNTRIES = ['AE', 'IN', 'DE', 'US', 'BR'];

export function visitor(i: number): Visitor {
  return { id: `sim-user-${i}`, country: COUNTRIES[i % COUNTRIES.length]! };
}
