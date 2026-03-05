import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("user_id");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;

  if (!userId) {
    return NextResponse.redirect(`${appUrl}/settings?error=whoop_no_user`);
  }

  const redirectUri = `${appUrl}/api/whoop/callback`;

  // Encode userId in state so the callback can recover it without server-side storage
  const state = Buffer.from(userId).toString("base64url");

  const authUrl = new URL("https://api.prod.whoop.com/oauth/oauth2/auth");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", process.env.WHOOP_CLIENT_ID!);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set(
    "scope",
    "offline read:recovery read:sleep read:cycles read:workout read:body_measurement",
  );
  authUrl.searchParams.set("state", state);

  return NextResponse.redirect(authUrl.toString());
}
