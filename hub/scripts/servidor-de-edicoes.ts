// Sobe o servidor de edições (features/edicoes): as edições de vídeo e o Whisper rodam aqui, fora do site.
// No Railway é o serviço "Hub Edições": a mesma imagem do hub (Dockerfile) com HUB_SERVIDOR=edicoes.
// No PC, para testar: HUB_CHAVE_DAS_EDICOES=<chave> PORT=8090 npm run servidor-de-edicoes, e no site
// HUB_SERVIDOR_DE_EDICOES=http://localhost:8090 com a mesma chave.
// Variáveis: HUB_CHAVE_DAS_EDICOES (obrigatória, a mesma do site), PORT (8080), HUB_EDICOES_SIMULTANEAS (2) e
// HUB_PASTA_DAS_EDICOES (.data/tmp/servidor-de-edicoes, apagada a cada subida: trabalho pela metade não volta).

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { TAMANHO_MINIMO_DA_CHAVE, VARIAVEL_DA_CHAVE } from "@/features/edicoes/contrato";
import { criarServidorDeEdicoes } from "@/features/edicoes/servicos/servidor";

async function principal() {
  const chave = process.env[VARIAVEL_DA_CHAVE]?.trim() ?? "";
  if (chave.length < TAMANHO_MINIMO_DA_CHAVE) {
    console.error(`[edicoes] falta ${VARIAVEL_DA_CHAVE} (mínimo ${TAMANHO_MINIMO_DA_CHAVE} caracteres), a mesma do site.`);
    return 1;
  }
  const pasta = process.env.HUB_PASTA_DAS_EDICOES?.trim() || path.join(process.cwd(), ".data", "tmp", "servidor-de-edicoes");
  // Trabalhos de uma subida anterior morreram com ela (o site manda de novo): a pasta começa vazia.
  await rm(pasta, { recursive: true, force: true });
  await mkdir(pasta, { recursive: true });
  const simultaneas = Number(process.env.HUB_EDICOES_SIMULTANEAS) || 2;
  const { servidor, faxina } = criarServidorDeEdicoes({ chave, pasta, simultaneas });
  const porta = Number(process.env.PORT) || 8080;
  // "::" atende IPv6 e IPv4: a rede privada do Railway usa IPv6.
  servidor.listen(porta, "::", () => console.log(`[edicoes] servidor de edições pronto na porta ${porta} (${simultaneas} edições por vez)`));
  setInterval(() => void faxina().catch(() => undefined), 15 * 60_000).unref();
  // Publicação nova ou parada: os trabalhos em andamento morrem, e o site manda de novo para a versão nova.
  for (const sinal of ["SIGTERM", "SIGINT"] as const) {
    process.on(sinal, () => {
      console.log(`[edicoes] ${sinal}: saindo (o site manda de novo o que estava rodando)`);
      servidor.close();
      process.exit(0);
    });
  }
  return 0;
}

principal().then(
  (codigo) => {
    if (codigo) process.exit(codigo);
  },
  (err) => {
    console.error("[edicoes] não deu para subir o servidor de edições:", err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
