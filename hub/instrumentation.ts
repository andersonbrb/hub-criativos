// Roda uma vez quando o servidor do hub sobe (convenção do Next.js: instrumentation.ts na raiz do app).
// - Continua as edições de vídeo que o reinício interrompeu.
// - Liga o relógio da fila do YouTube: os envios agendados saem na hora mesmo que ninguém esteja com o hub aberto, e
//   um envio que o reinício interrompeu continua de onde parou.
// - Liga a faxina dos vídeos (regra do dono: vídeo só fica guardado no Google Drive): leva ao Drive o que ficou no
//   disco, descarta o que passou do prazo e apaga as sobras (features/drive/servicos/faxina.ts).
// - Liga a agenda do Instagram (publicações na hora marcada).
// Uma falha aqui nunca impede o servidor de subir.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Edições que estavam em andamento quando o servidor parou (publicação nova, queda): continuam sozinhas, no servidor
  // de edições ou aqui (features/edicoes/servicos/rodar.ts). Antes da faxina, para ela não apagar a pasta delas.
  try {
    const { retomarEdicoes } = await import("@/features/edicoes/servicos/rodar");
    await retomarEdicoes();
  } catch (err) {
    console.error("[hub] não deu para continuar as edições em andamento:", err instanceof Error ? err.message : err);
  }
  try {
    const { iniciarFilaDoYoutube } = await import("@/features/youtube/servicos/envios");
    iniciarFilaDoYoutube();
  } catch (err) {
    console.error("[hub] não deu para ligar a fila do YouTube:", err instanceof Error ? err.message : err);
  }
  try {
    const { iniciarFaxinaDosVideos } = await import("@/features/drive/servicos/faxina");
    iniciarFaxinaDosVideos();
  } catch (err) {
    console.error("[hub] não deu para ligar a faxina dos vídeos:", err instanceof Error ? err.message : err);
  }
  // Instagram (migrado em 29/10/2026): publica na grade de horários de cada conta e retoma as peças que o reinício
  // interrompeu (features/instagram/servicos/agenda.ts). Só com o banco: o Instagram mora nele.
  if (process.env.DATABASE_URL?.trim()) {
    void import("@/features/instagram/servicos/agenda")
      .then(({ iniciarAgendaDoInstagram }) => iniciarAgendaDoInstagram())
      .catch((err) => console.error("[instagram] não deu para ligar a agenda de publicações:", err instanceof Error ? err.message : err));
  }
  // Pedido do dono (28/10/2026): o login de administrador fica nas variáveis do servidor. A senha de
  // SENHA_DO_DONO_DA_PLATAFORMA passa a valer para o primeiro e-mail de DONOS_DA_PLATAFORMA (features/acesso/servicos/donos.ts).
  if (process.env.DATABASE_URL?.trim()) {
    void import("@/features/acesso/servicos/donos")
      .then(({ aplicarSenhaDoDonoDasVariaveis }) => aplicarSenhaDoDonoDasVariaveis())
      .then((resultado) => console.log(`[donos] senha do dono da plataforma: ${resultado}.`))
      .catch((err) => console.error("[donos] não deu para aplicar a senha do dono da plataforma:", err instanceof Error ? err.message : err));
  }
  // Decisão de 20/10/2026 (como fazer vídeo segue só o contexto do Sávio): leva para a Memória o documento das decisões
  // fechado e os playbooks novos, em segundo plano (features/memoria/servicos/decisoes-do-savio.ts). Rodar de novo não
  // grava nada; documento editado na tela não é trocado (vai para a revisão).
  void import("@/features/memoria/servicos/decisoes-do-savio")
    .then(({ aplicarDecisoesEmTodasAsOrganizacoes }) => aplicarDecisoesEmTodasAsOrganizacoes())
    .catch((err) => console.error("[hub] não deu para aplicar as decisões do Sávio na Memória:", err instanceof Error ? err.message : err));
}
