/*
  GST split logic — pure, framework-free (see lib/gl.ts for the same pattern).

  Rule (per the team): if the customer's billing address is in Maharashtra
  (Verve's home state), the supply is intra-state -> split GST into CGST +
  SGST. Otherwise it's inter-state -> the whole amount is IGST.

  Reality note: `customers` has no dedicated `state` column, only a free-text
  `address`, so state is detected by matching known Indian state/UT names
  inside that address. `invoices.tax_amount` stays a single column (the golden
  rule is never alter the backend), so this split is a DISPLAY breakdown of
  that one stored number — not separate persisted CGST/SGST/IGST fields.
*/

export const HOME_STATE = "Maharashtra";

// Enough of the states/UTs list to recognise what's typed into a free-text
// address; longest names first so "Uttar Pradesh" isn't shadowed by "Uttarakhand".
const INDIAN_STATES = [
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
].sort((a, b) => b.length - a.length);

// Seeded customer addresses here are just a city name ("Mumbai", "Pune"), not
// the state — so matching only full state names would misclassify every one
// of them as inter-state. Map the major cities actually seen (and other big
// metros) to their state so detection works on real addresses, not just ones
// that spell the state out.
const CITY_TO_STATE: Record<string, string> = {
  mumbai: "Maharashtra",
  pune: "Maharashtra",
  nagpur: "Maharashtra",
  nashik: "Maharashtra",
  thane: "Maharashtra",
  delhi: "Delhi",
  "new delhi": "Delhi",
  gurugram: "Haryana",
  gurgaon: "Haryana",
  ahmedabad: "Gujarat",
  surat: "Gujarat",
  bengaluru: "Karnataka",
  bangalore: "Karnataka",
  hyderabad: "Telangana",
  chennai: "Tamil Nadu",
  kolkata: "West Bengal",
  jaipur: "Rajasthan",
  lucknow: "Uttar Pradesh",
  chandigarh: "Chandigarh",
  bhopal: "Madhya Pradesh",
  indore: "Madhya Pradesh",
  kochi: "Kerala",
  coimbatore: "Tamil Nadu",
};

/** Best-guess state name found inside a free-text address, or null. */
export function detectStateFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const hay = address.toLowerCase();
  for (const state of INDIAN_STATES) {
    if (hay.includes(state.toLowerCase())) return state;
  }
  for (const [city, state] of Object.entries(CITY_TO_STATE)) {
    if (hay.includes(city)) return state;
  }
  return null;
}

export function isIntraState(address: string | null | undefined): boolean {
  return detectStateFromAddress(address) === HOME_STATE;
}

export interface GstSplit {
  intraState: boolean;
  customerState: string | null;
  cgst: number;
  sgst: number;
  igst: number;
}

/** Split a total GST amount into CGST+SGST (intra-state) or IGST (inter-state). */
export function splitGst(totalGst: number, address: string | null | undefined): GstSplit {
  const state = detectStateFromAddress(address);
  const intra = state === HOME_STATE;
  const amount = Number.isFinite(totalGst) ? totalGst : 0;
  return intra
    ? { intraState: true, customerState: state, cgst: amount / 2, sgst: amount / 2, igst: 0 }
    : { intraState: false, customerState: state, cgst: 0, sgst: 0, igst: amount };
}
