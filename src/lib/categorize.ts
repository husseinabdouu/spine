// ── Category hierarchy ────────────────────────────────────────────────────────

export type ParentCategory =
  | "Food"
  | "Transportation"
  | "Purchases"
  | "Health & Wellness"
  | "Subscriptions"
  | "Entertainment"
  | "Investments"
  | "Other";

export type SubCategory =
  // Food
  | "Food Delivery"
  | "Dining Out"
  | "Groceries"
  | "Snacks & Drinks"
  // Transportation
  | "Taxis & Rideshare"
  | "Public Transit"
  | "Gas"
  | "Travel"
  // Purchases
  | "Clothing"
  | "Gifts"
  | "Personal Care"
  | "Needs"
  | "Wants"
  // Health & Wellness
  | "Gym & Fitness"
  | "Medical"
  // Subscriptions (single bucket)
  | "Subscriptions"
  // Entertainment
  | "Events & Concerts"
  | "Nightlife"
  | "Gambling & Betting"
  // Investments / Other (single bucket, stored as their parent name)
  | "Investments"
  | "Other";

/** System categories — excluded from spending totals and never shown in the user picker. */
export const NON_BEHAVIORAL_CATEGORIES = [
  "Internal Transfer",
  "ATM Withdrawal",
  "Income",
] as const;
export type NonBehavioralCategory = (typeof NON_BEHAVIORAL_CATEGORIES)[number];

/**
 * Full parent → subcategories map (user-facing).
 * Single-bucket parents list only themselves as their sole subcategory.
 */
export const CATEGORY_TREE: Record<ParentCategory, SubCategory[]> = {
  Food:               ["Food Delivery", "Dining Out", "Groceries", "Snacks & Drinks"],
  Transportation:     ["Taxis & Rideshare", "Public Transit", "Gas", "Travel"],
  Purchases:          ["Clothing", "Gifts", "Personal Care", "Needs", "Wants"],
  "Health & Wellness": ["Gym & Fitness", "Medical"],
  Subscriptions:      ["Subscriptions"],
  Entertainment:      ["Events & Concerts", "Nightlife", "Gambling & Betting"],
  Investments:        ["Investments"],
  Other:              ["Other"],
};

export const PARENT_CATEGORIES = Object.keys(CATEGORY_TREE) as ParentCategory[];

/** All user-facing subcategories in a flat array. */
export const USER_SUBCATEGORIES: SubCategory[] = Object.values(CATEGORY_TREE).flat();

/** All valid categories stored in the DB (subcategories + system categories). */
export const ALL_CATEGORIES = [
  ...USER_SUBCATEGORIES,
  ...NON_BEHAVIORAL_CATEGORIES,
] as const;

/**
 * Behavioral impulse weight for each subcategory (0–1).
 * 0 = no impulse risk; 1 = maximum impulse risk.
 * Used to weight spending in behavioral tax calculations.
 */
export const SUBCATEGORY_WEIGHTS: Record<SubCategory, number> = {
  "Food Delivery":     0.9,
  "Dining Out":        0.5,
  "Groceries":         0.1,
  "Snacks & Drinks":   0.65,
  "Taxis & Rideshare": 0.7,
  "Public Transit":    0.0,
  "Gas":               0.0,
  "Travel":            0.4,
  "Clothing":          0.7,
  "Gifts":             0.5,
  "Personal Care":     0.3,
  "Needs":             0.1,
  "Wants":             0.8,
  "Gym & Fitness":     0.0,
  "Medical":           0.0,
  "Subscriptions":     0.0,
  "Events & Concerts": 0.3,
  "Nightlife":         0.8,
  "Gambling & Betting":0.9,
  "Investments":       0.3,
  "Other":             0.4,
};

/** Look up the behavioral weight for any stored category string. */
export function getBehavioralWeight(category: string | null | undefined): number {
  if (!category) return 0.4;
  return SUBCATEGORY_WEIGHTS[category as SubCategory] ?? 0.4;
}

/** Find which parent a subcategory belongs to. */
export function getParentCategory(sub: string | null | undefined): ParentCategory | null {
  if (!sub) return null;
  for (const [parent, subs] of Object.entries(CATEGORY_TREE)) {
    if ((subs as string[]).includes(sub)) return parent as ParentCategory;
  }
  return null;
}

// ── Colors ────────────────────────────────────────────────────────────────────

export const CATEGORY_COLORS: Record<string, string> = {
  // Food
  "Food Delivery":     "#ef4444",
  "Dining Out":        "#f59e0b",
  "Groceries":         "#22c55e",
  "Snacks & Drinks":   "#d97706",
  // Transportation
  "Taxis & Rideshare": "#06b6d4",
  "Public Transit":    "#0ea5e9",
  "Gas":               "#64748b",
  "Travel":            "#8b5cf6",
  // Purchases
  "Clothing":          "#a855f7",
  "Gifts":             "#ec4899",
  "Personal Care":     "#f472b6",
  "Needs":             "#6b7280",
  "Wants":             "#c026d3",
  // Health & Wellness
  "Gym & Fitness":     "#10b981",
  "Medical":           "#34d399",
  // Subscriptions
  "Subscriptions":     "#3b82f6",
  // Entertainment
  "Events & Concerts": "#f97316",
  "Nightlife":         "#e11d48",
  "Gambling & Betting":"#dc2626",
  // Investments / Other
  "Investments":       "#0891b2",
  "Other":             "#71717a",
  // System categories (display-only, never in picker)
  "Internal Transfer": "#94a3b8",
  "ATM Withdrawal":    "#a3a3a3",
  "Income":            "#4ade80",
};

// ── Plaid mapping ─────────────────────────────────────────────────────────────

// Maps Plaid primary categories → Spine subcategories
const PLAID_TO_SUB: Record<string, SubCategory> = {
  // Food
  FOOD_AND_DRINK:         "Dining Out",
  RESTAURANTS:            "Dining Out",
  FAST_FOOD:              "Food Delivery",
  FOOD_DELIVERY:          "Food Delivery",
  GROCERIES:              "Groceries",
  COFFEE_SHOP:            "Snacks & Drinks",

  // Transportation
  TRANSPORTATION:         "Taxis & Rideshare",
  TAXIS_AND_RIDE_SHARES:  "Taxis & Rideshare",
  PUBLIC_TRANSPORTATION_SERVICES: "Public Transit",
  GAS_STATIONS:           "Gas",
  TRAVEL:                 "Travel",
  AIRLINES_AND_AVIATION_SERVICES: "Travel",
  CAR_RENTAL:             "Travel",
  HOTELS:                 "Travel",
  LODGING:                "Travel",
  PARKING:                "Gas",
  AUTOMOTIVE:             "Gas",

  // Purchases
  CLOTHING_AND_ACCESSORIES: "Clothing",
  GENERAL_MERCHANDISE:    "Wants",
  ONLINE_MARKETPLACE:     "Wants",
  DEPARTMENT_STORES:      "Wants",
  DISCOUNT_STORES:        "Wants",
  SPORTING_GOODS:         "Wants",
  ELECTRONICS:            "Wants",
  HOME_IMPROVEMENT:       "Needs",
  HARDWARE_STORE:         "Needs",
  BOOKSTORES:             "Wants",
  DIGITAL_PURCHASE:       "Subscriptions",
  DRUG_STORE:             "Personal Care",
  MUSIC:                  "Subscriptions",
  VIDEO_GAMES:            "Wants",

  // Health & Wellness
  MEDICAL:                "Medical",
  HEALTH_AND_FITNESS:     "Gym & Fitness",
  GYMS_AND_FITNESS_CENTERS: "Gym & Fitness",
  PERSONAL_CARE:          "Personal Care",

  // Subscriptions / Utilities / Essentials
  SUBSCRIPTION:           "Subscriptions",
  STREAMING_SERVICES:     "Subscriptions",
  TELECOMMUNICATION_SERVICES: "Subscriptions",
  CABLE:                  "Subscriptions",
  INTERNET_SERVICES:      "Subscriptions",
  UTILITIES:              "Needs",
  RENT_AND_UTILITIES:     "Needs",
  RENT:                   "Needs",
  INSURANCE:              "Needs",
  EDUCATION:              "Needs",
  CHILD_AND_FAMILY_CARE:  "Needs",
  CHILDCARE:              "Needs",
  VETERINARY_SERVICES:    "Medical",
  PET_FOOD_SUPPLIES:      "Needs",
  LAUNDRY_AND_DRY_CLEANING: "Personal Care",
  HOME_SERVICES:          "Needs",

  // Entertainment
  ENTERTAINMENT:          "Events & Concerts",
  ARTS_AND_ENTERTAINMENT: "Events & Concerts",
  RECREATION:             "Events & Concerts",
  SPORTING_EVENTS:        "Events & Concerts",
  MOVIE_THEATERS:         "Events & Concerts",
  AMUSEMENT_PARKS:        "Events & Concerts",
  NIGHTLIFE:              "Nightlife",
  BARS:                   "Nightlife",

  // Investments / Other
  FINANCIAL_PLANNING:     "Investments",
  GIFTS_AND_DONATIONS:    "Gifts",
  CHARITIES_AND_NON_PROFITS: "Gifts",
  CHARITY:                "Gifts",
  DONATIONS:              "Gifts",

  BANK_FEES:              "Other",
  GOVERNMENT_AND_NON_PROFIT: "Other",
  GENERAL_SERVICES:       "Other",
  LOAN_PAYMENTS:          "Other",
  TRANSFER_OUT:           "Other",
  OVERDRAFT:              "Other",
  FRAUD_DISPUTE:          "Other",
  ATM:                    "Other",
  BUSINESS_AND_PROFESSIONAL_SERVICES: "Other",
  TAXES:                  "Other",
  LEGAL_SERVICES:         "Other",
  ACCOUNTANTS:            "Other",
};

export function mapPlaidCategory(raw: string | null | undefined): SubCategory {
  if (!raw) return "Other";
  const key = raw.toUpperCase().replace(/[\s\-]+/g, "_");
  return PLAID_TO_SUB[key] ?? "Other";
}

// ── Resolution helpers ────────────────────────────────────────────────────────

/**
 * Resolve any stored category string to a SubCategory.
 * Handles: already-valid subcategories, old category names (migration),
 * and raw Plaid strings.
 */
export function resolveCategory(category: string | null | undefined): SubCategory | NonBehavioralCategory {
  if (!category) return "Other";

  // Already a valid subcategory or system category
  if ((ALL_CATEGORIES as readonly string[]).includes(category))
    return category as SubCategory | NonBehavioralCategory;

  // System categories by exact name
  if (category === "Internal Transfer") return "Internal Transfer";
  if (category === "ATM Withdrawal")    return "ATM Withdrawal";
  if (category === "Income")            return "Income";

  // Legacy category names → current subcategory
  const LEGACY: Record<string, SubCategory> = {
    "Food & Drink":    "Dining Out",
    "Shopping":        "Wants",
    "Outings":         "Events & Concerts",
    "Essentials":      "Needs",
    "Gifts":           "Gifts",
    "Transportation":  "Taxis & Rideshare",
    "Other":           "Other",
    "Coffee & Drinks": "Snacks & Drinks",   // renamed
  };
  if (LEGACY[category]) return LEGACY[category];

  // Fall back to Plaid mapper
  return mapPlaidCategory(category);
}

export function isNonBehavioral(category: string | null | undefined): boolean {
  return !!category && (NON_BEHAVIORAL_CATEGORIES as readonly string[]).includes(category);
}

/** True if this category should be excluded from all spending calculations. */
export function isExcludedCategory(category: string | null | undefined): boolean {
  return isNonBehavioral(category);
}
