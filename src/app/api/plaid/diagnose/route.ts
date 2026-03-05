import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { plaidClient } from "@/lib/plaid/client";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";

export const maxDuration = 60;

/**
 * POST /api/plaid/diagnose
 *
 * Comprehensive read-only diagnostic — NO writes to DB.
 * Returns:
 *   - What Spine's DB actually has (count, date range)
 *   - What Plaid's itemGet says (webhook URL, item errors, update_type)
 *   - What Plaid claims total_transactions is for the full date range
 *   - Month-by-month breakdown: Plaid count vs DB count
 *
 * Body: { user_id: string, months?: number }
 */
export async function POST(request: Request) {
  try {
    const { user_id, months = 18 } = await request.json();
    if (!user_id) {
      return NextResponse.json({ error: "Missing user_id" }, { status: 400 });
    }

    const supabase = await createClient();

    // ── 1. DB stats ──────────────────────────────────────────────────────────
    const [{ count: dbTotal }, { data: dbRange }] = await Promise.all([
      supabase
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user_id),
      supabase
        .from("transactions")
        .select("posted_at")
        .eq("user_id", user_id)
        .order("posted_at", { ascending: true })
        .limit(1)
        .then(async (first) => {
          const last = await supabase
            .from("transactions")
            .select("posted_at")
            .eq("user_id", user_id)
            .order("posted_at", { ascending: false })
            .limit(1);
          return {
            data: {
              oldest: first.data?.[0]?.posted_at ?? null,
              newest: last.data?.[0]?.posted_at ?? null,
            },
          };
        }),
    ]);

    // ── 2. Plaid item from DB ─────────────────────────────────────────────────
    const { data: plaidItems, error: itemsError } = await supabase
      .from("plaid_items")
      .select("id, access_token, item_id, institution_name, cursor, created_at")
      .eq("user_id", user_id);

    if (itemsError || !plaidItems?.length) {
      return NextResponse.json({
        error: "No Plaid items found for this user",
        db: { total: dbTotal, ...(dbRange as object) },
      }, { status: 400 });
    }

    const item = plaidItems[0];

    // ── 3. Plaid itemGet — webhook URL, item errors, update_type ─────────────
    let plaidItemStatus: Record<string, unknown> = {};
    try {
      const { data: itemData } = await plaidClient.itemGet({
        access_token: item.access_token,
      });
      const i = itemData.item;
      plaidItemStatus = {
        item_id:            i.item_id,
        webhook:            i.webhook ?? null,
        error:              i.error ? JSON.stringify(i.error) : null,
        update_type:        i.update_type ?? null,
        available_products: i.available_products ?? [],
        billed_products:    i.billed_products ?? [],
        consent_expiration: i.consent_expiration_time ?? null,
      };
    } catch (e: unknown) {
      plaidItemStatus = {
        error: `itemGet failed: ${(e as { response?: { data?: { error_message?: string } } })?.response?.data?.error_message ?? String(e)}`,
      };
    }

    // ── 4. Plaid accountsGet — which accounts are actually linked ─────────────
    let linkedAccounts: { account_id: string; name: string; official_name: string | null; type: string; subtype: string | null; mask: string | null }[] = [];
    try {
      const { data: acctData } = await plaidClient.accountsGet({
        access_token: item.access_token,
      });
      linkedAccounts = acctData.accounts.map(a => ({
        account_id:    a.account_id,
        name:          a.name,
        official_name: a.official_name ?? null,
        type:          a.type,
        subtype:       a.subtype ?? null,
        mask:          a.mask ?? null,
      }));
    } catch (e: unknown) {
      console.warn("[diagnose] accountsGet failed:", e);
    }

    // ── 6. Plaid total_transactions for the full range ────────────────────────
    const today       = format(new Date(), "yyyy-MM-dd");
    const cutoffDate  = format(subMonths(new Date(), months), "yyyy-MM-dd");

    let plaidTotalClaim = 0;
    let plaidTotalError: string | null = null;
    try {
      const { data: txData } = await plaidClient.transactionsGet({
        access_token: item.access_token,
        start_date:   cutoffDate,
        end_date:     today,
        options:      { count: 1, offset: 0, include_personal_finance_category: true },
      });
      plaidTotalClaim = txData.total_transactions;
    } catch (e: unknown) {
      plaidTotalError = (e as { response?: { data?: { error_message?: string } } })?.response?.data?.error_message ?? String(e);
    }

    // ── 7. Month-by-month breakdown ───────────────────────────────────────────
    const monthlyBreakdown: {
      month: string;
      plaid_count:   number | null;
      db_count:      number;
      plaid_error?:  string;
    }[] = [];

    for (let m = months - 1; m >= 0; m--) {
      const refDate   = subMonths(new Date(), m);
      const monthStr  = format(refDate, "yyyy-MM");
      const monthStart = format(startOfMonth(refDate), "yyyy-MM-dd");
      const monthEnd   = format(endOfMonth(refDate),   "yyyy-MM-dd");

      // DB count for this month
      const { count: dbMonthCount } = await supabase
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user_id)
        .gte("posted_at", monthStart)
        .lte("posted_at", monthEnd);

      // Plaid count for this month (count=1 just to read total_transactions)
      let plaidMonthCount: number | null = null;
      let plaidMonthError: string | undefined;
      try {
        const { data: mData } = await plaidClient.transactionsGet({
          access_token: item.access_token,
          start_date:   monthStart,
          end_date:     monthEnd,
          options:      { count: 1, offset: 0 },
        });
        plaidMonthCount = mData.total_transactions;
      } catch (e: unknown) {
        plaidMonthError = (e as { response?: { data?: { error_message?: string } } })?.response?.data?.error_message ?? String(e);
      }

      monthlyBreakdown.push({
        month:        monthStr,
        plaid_count:  plaidMonthCount,
        db_count:     dbMonthCount ?? 0,
        ...(plaidMonthError ? { plaid_error: plaidMonthError } : {}),
      });
    }

    const totalPlaidFromMonths = monthlyBreakdown.reduce(
      (sum, m) => sum + (m.plaid_count ?? 0), 0
    );

    return NextResponse.json({
      db: {
        total:    dbTotal   ?? 0,
        oldest:   (dbRange as { oldest: string | null; newest: string | null }).oldest,
        newest:   (dbRange as { oldest: string | null; newest: string | null }).newest,
      },
      linked_accounts: linkedAccounts,
      plaid_item_db: {
        id:           item.id,
        item_id:      item.item_id,
        institution:  item.institution_name,
        cursor:       item.cursor ? "SET" : "NULL",
        connected_at: item.created_at,
      },
      plaid_item_live: plaidItemStatus,
      plaid_full_range: {
        start_date:           cutoffDate,
        end_date:             today,
        total_claimed:        plaidTotalClaim,
        error:                plaidTotalError,
        gap:                  plaidTotalClaim - (dbTotal ?? 0),
      },
      monthly_breakdown: monthlyBreakdown,
      monthly_totals: {
        plaid_sum:  totalPlaidFromMonths,
        db_total:   dbTotal ?? 0,
        gap:        totalPlaidFromMonths - (dbTotal ?? 0),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[diagnose] Fatal:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
