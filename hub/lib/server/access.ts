import { createHmac, timingSafeEqual } from "node:crypto";

// Senha de acesso do hub hospedado (Railway). Sem HUB_PASSWORD (no PC), nada é bloqueado.
export const ACCESS_COOKIE = "hub_acesso";

export const accessPassword = () => process.env.HUB_PASSWORD?.trim() || null;

// O cookie guarda um HMAC da senha, não a senha: trocar HUB_PASSWORD desloga todo mundo.
export const accessToken = (password: string) => createHmac("sha256", password).update("hub-criativos:acesso:v1").digest("hex");

export function sameSecret(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Só aceita voltar para um caminho do próprio hub (evita redirecionar para fora).
export const safeNext = (next: unknown) => (typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/");

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Página de senha servida direto pelo proxy, fora do layout (sem menu nem chamadas à API).
export function loginPage(next: string, error = false) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Hub de Criativos</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f5f3; --card: #fff; --fg: #1b1a19; --muted: #6b6864; --line: #e3e0dc; --rec: #e5484d; }
  @media (prefers-color-scheme: dark) { :root { --bg: #121110; --card: #1c1b1a; --fg: #f1efec; --muted: #a29e98; --line: #2e2c2a; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100svh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
  form { width: 100%; max-width: 340px; display: grid; gap: 12px; padding: 24px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; }
  h1 { margin: 0; font-size: 18px; }
  p { margin: 0; color: var(--muted); font-size: 13px; }
  input { width: 100%; padding: 10px 12px; font: inherit; color: inherit; background: transparent; border: 1px solid var(--line); border-radius: 8px; }
  input:focus { outline: 2px solid var(--rec); outline-offset: 1px; }
  button { padding: 10px 12px; font: inherit; font-weight: 600; color: #fff; background: var(--rec); border: 0; border-radius: 8px; cursor: pointer; }
  .erro { color: var(--rec); }
</style>
</head>
<body>
<form method="post" action="/api/entrar">
  <h1>Hub de Criativos</h1>
  <p>Digite a senha de acesso.</p>
  ${error ? '<p class="erro" role="alert">Senha incorreta.</p>' : ""}
  <input type="password" name="senha" aria-label="Senha" autocomplete="current-password" autofocus required>
  <input type="hidden" name="next" value="${escape(next)}">
  <button type="submit">Entrar</button>
</form>
</body>
</html>`;
}
