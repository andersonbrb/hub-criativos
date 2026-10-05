import { ACCESS_COOKIE, accessPassword, accessToken, loginPage, safeNext, sameSecret } from "@/lib/server/access";

// Recebe o formulário da página de senha (lib/server/access.ts) e grava o cookie de acesso.
export async function POST(request: Request) {
  const form = await request.formData();
  const next = safeNext(form.get("next"));
  const password = accessPassword();
  if (!password) return Response.redirect(new URL(next, request.url), 303);

  if (!sameSecret(String(form.get("senha") ?? ""), password)) {
    await new Promise((r) => setTimeout(r, 600)); // freia tentativas em sequência
    return new Response(loginPage(next, true), { status: 401, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  const secure = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  return new Response(null, {
    status: 303,
    headers: {
      Location: next,
      "Set-Cookie": `${ACCESS_COOKIE}=${accessToken(password)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${secure ? "; Secure" : ""}`,
    },
  });
}
