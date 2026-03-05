export const USER_CATEGORIES = [
  "Food & Drink",
  "Transportation",
  "Shopping",
  "Outings",
  "Essentials",
  "Gifts",
  "Others",
] as const;

export const INCOME_CATEGORIES = [
  "Salary",
  "Allowance",
  "Gift",
  "Interest",
  "Capital Gains",
  "Other Income",
] as const;

export type UserCategory = (typeof USER_CATEGORIES)[number];
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];

export const CATEGORY_COLORS: Record<string, string> = {
  "Food & Drink": "#f59e0b",
  "Transportation": "#06b6d4",
  "Shopping": "#8b5cf6",
  "Outings": "#ec4899",
  "Essentials": "#22c55e",
  "Gifts": "#ef4444",
  "Others": "#71717a",
};

// Maps Plaid's personal_finance_category.primary values → our 7 categories
const PLAID_TO_USER: Record<string, UserCategory> = {
  // Food
  FOOD_AND_DRINK: "Food & Drink",
  RESTAURANTS: "Food & Drink",
  GROCERIES: "Food & Drink",
  FAST_FOOD: "Food & Drink",
  COFFEE_SHOP: "Food & Drink",
  FOOD_DELIVERY: "Food & Drink",

  // Transportation
  TRANSPORTATION: "Transportation",
  TRAVEL: "Transportation",
  AIRLINES_AND_AVIATION_SERVICES: "Transportation",
  TAXIS_AND_RIDE_SHARES: "Transportation",
  CAR_RENTAL: "Transportation",
  GAS_STATIONS: "Transportation",
  PARKING: "Transportation",
  PUBLIC_TRANSPORTATION_SERVICES: "Transportation",
  AUTOMOTIVE: "Transportation",

  // Shopping
  GENERAL_MERCHANDISE: "Shopping",
  CLOTHING_AND_ACCESSORIES: "Shopping",
  HOME_IMPROVEMENT: "Shopping",
  SPORTING_GOODS: "Shopping",
  ELECTRONICS: "Shopping",
  BOOKSTORES: "Shopping",
  DIGITAL_PURCHASE: "Shopping",
  ONLINE_MARKETPLACE: "Shopping",
  DEPARTMENT_STORES: "Shopping",
  DISCOUNT_STORES: "Shopping",
  DRUG_STORE: "Shopping",
  HARDWARE_STORE: "Shopping",
  MUSIC: "Shopping",
  VIDEO_GAMES: "Shopping",

  // Outings
  ENTERTAINMENT: "Outings",
  RECREATION: "Outings",
  ARTS_AND_ENTERTAINMENT: "Outings",
  GYMS_AND_FITNESS_CENTERS: "Outings",
  NIGHTLIFE: "Outings",
  BARS: "Outings",
  SPORTING_EVENTS: "Outings",
  MOVIE_THEATERS: "Outings",
  HOTELS: "Outings",
  LODGING: "Outings",
  AMUSEMENT_PARKS: "Outings",

  // Essentials
  PERSONAL_CARE: "Essentials",
  MEDICAL: "Essentials",
  HEALTH_AND_FITNESS: "Essentials",
  UTILITIES: "Essentials",
  RENT_AND_UTILITIES: "Essentials",
  INSURANCE: "Essentials",
  EDUCATION: "Essentials",
  CHILD_AND_FAMILY_CARE: "Essentials",
  CHILDCARE: "Essentials",
  VETERINARY_SERVICES: "Essentials",
  PET_FOOD_SUPPLIES: "Essentials",
  TELECOMMUNICATION_SERVICES: "Essentials",
  CABLE: "Essentials",
  INTERNET_SERVICES: "Essentials",
  SUBSCRIPTION: "Essentials",
  STREAMING_SERVICES: "Essentials",
  LAUNDRY_AND_DRY_CLEANING: "Essentials",
  HOME_SERVICES: "Essentials",
  RENT: "Essentials",

  // Gifts
  GIFTS_AND_DONATIONS: "Gifts",
  CHARITIES_AND_NON_PROFITS: "Gifts",
  CHARITY: "Gifts",
  DONATIONS: "Gifts",

  // Others
  BANK_FEES: "Others",
  GOVERNMENT_AND_NON_PROFIT: "Others",
  GENERAL_SERVICES: "Others",
  LOAN_PAYMENTS: "Others",
  TRANSFER_OUT: "Others",
  OVERDRAFT: "Others",
  FRAUD_DISPUTE: "Others",
  ATM: "Others",
  BUSINESS_AND_PROFESSIONAL_SERVICES: "Others",
  FINANCIAL_PLANNING: "Others",
  TAXES: "Others",
  LEGAL_SERVICES: "Others",
  ACCOUNTANTS: "Others",
};

export function mapPlaidCategory(raw: string | null | undefined): UserCategory {
  if (!raw) return "Others";
  const key = raw.toUpperCase().replace(/[\s\-]+/g, "_");
  return PLAID_TO_USER[key] ?? "Others";
}

// Handles both stored custom categories and legacy Plaid raw strings
export function resolveCategory(category: string | null | undefined): UserCategory {
  if (!category) return "Others";
  if ((USER_CATEGORIES as readonly string[]).includes(category)) return category as UserCategory;
  return mapPlaidCategory(category);
}

export function isUserCategory(cat: string | null | undefined): cat is UserCategory {
  return !!cat && (USER_CATEGORIES as readonly string[]).includes(cat);
}
