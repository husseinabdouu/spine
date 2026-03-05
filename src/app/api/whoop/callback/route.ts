import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exchangeWhoopCode, getWhoopUserId } from "@/lib/wearables/whoop";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const appUrl      = process.env.NEXT_PUBLIC_APP_URL!;
  const code        = searchParams.get("code");
  const state       = searchParams.get("state");
  const oauthError  = searchParams.get("error");

  if (oauthError || !code || !state) {
    return NextResponse.redirect(`${appUrl}/settings?error=whoop_denied`);
  }

  let userId: string;
  try {
    userId = Buffer.from(state, "base64url").toString("utf-8");
    if (!userId) throw new Error("empty userId");
  } catch {
    return NextResponse.redirect(`${appUrl}/settings?error=whoop_invalid_state`);
  }

  try {
    const redirectUri = `${appUrl}/api/whoop/callback`;
    const tokens      = await exchangeWhoopCode(code, redirectUri);
    const whoopUserId = await getWhoopUserId(tokens.access_token);
    const expiresAt   = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    const supabase = createClient();
    const { error: dbError } = await supabase
      .from("whoop_connections")
      .upsert(
        {
          user_id:       userId,
          whoop_user_id: whoopUserId,
          access_token:  tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at:    expiresAt,
          scope:         "offline read:recovery read:sleep read:cycles read:workout",
          updated_at:    new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

    if (dbError) {
      console.error("Whoop callback DB error:", dbError);
      return NextResponse.redirect(`${appUrl}/settings?error=whoop_db_error`);
    }

    // Kick off an immediate sync for yesterday (fire-and-forget)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split("T")[0];

    fetch(`${appUrl}/api/whoop/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, date: dateStr }),
    }).catch((err) => console.error("Initial Whoop sync error:", err));

    return NextResponse.redirect(`${appUrl}/settings?whoop=connected`);
  } catch (err) {
    console.error("Whoop callback error:", err);
    return NextResponse.redirect(`${appUrl}/settings?error=whoop_failed`);
  }
}
