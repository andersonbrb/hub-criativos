import type { NextConfig } from "next";

// Cabeçalhos de segurança em toda resposta (páginas, APIs e arquivos):
// - nenhum site abre o hub dentro de um iframe (o hub também não se abre em iframe), o que impede um site falso de
//   esconder os botões do hub sob um clique da pessoa;
// - o navegador não adivinha o tipo de um arquivo (uma mídia enviada não vira página com script);
// - endereços internos do hub (ids, tokens no caminho) não vão inteiros para os sites abertos a partir dele;
// - depois de abrir o hub em HTTPS, o navegador não aceita mais a versão sem cadeado por um ano. Em http (PC) o
//   navegador ignora este cabeçalho.
const CABECALHOS_DE_SEGURANCA = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

const nextConfig: NextConfig = {
  // Esconde o botão "N" do Next no canto da tela (erros de compilação/execução continuam aparecendo).
  devIndicators: false,
  experimental: {
    // O proxy só cobre as páginas (proxy.ts), que recebem só GET: 1 MB basta e um POST numa página, mesmo sem conta,
    // não ocupa mais que isso de memória. Os envios grandes (vídeo, música, fotos) vão para /api/, que fica fora do
    // proxy e lê o corpo direto, sem esse teto.
    proxyClientMaxBodySize: "1mb",
  },
  async headers() {
    return [{ source: "/:path*", headers: CABECALHOS_DE_SEGURANCA }];
  },
};

export default nextConfig;
