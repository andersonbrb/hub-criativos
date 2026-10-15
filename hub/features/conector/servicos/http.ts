import "server-only";

// Pedaços HTTP das rotas públicas do conector (/.well-known, /oauth2, /mcp e links de arquivo).

export function json(dados: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

// Resposta com segredo (token, código) ou que depende do momento: nenhum cache guarda.
export const SEM_CACHE = { "Cache-Control": "no-store", Pragma: "no-cache" };

// Lê o corpo até o teto, sem deixar um corpo gigante entrar inteiro na memória: estas rotas respondem a quem não
// fez login. O Content-Length pode mentir para menos, então o tamanho real é contado durante a leitura.
// null = passou do teto.
export async function lerCorpo(request: Request, teto: number): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > teto) return null;
  if (!request.body) return "";
  const leitor = request.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > teto) {
      await leitor.cancel().catch(() => undefined);
      return null;
    }
    partes.push(value);
  }
  return Buffer.concat(partes).toString("utf8");
}

const escaparHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Erro ANTES de o endereço de retorno estar validado: nunca redireciona (redirecionar para um endereço não validado
// entregaria o erro, e o state, a quem montou o link).
export function paginaDeErro(mensagem: string, status = 400): Response {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Não foi possível conectar o Claude</title><style>body{font-family:system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 20px;line-height:1.5;background:#1f1f1f;color:#f5f5f5}h1{font-size:20px}</style></head><body><h1>Não foi possível conectar o Claude</h1><p>${escaparHtml(mensagem)}</p><p>Volte ao Claude e tente conectar de novo. Se continuar, avise quem cuida do Hub de Criativos.</p></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...SEM_CACHE } });
}

export const redirecionar = (destino: string) => new Response(null, { status: 302, headers: { Location: destino, ...SEM_CACHE } });
