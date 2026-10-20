// Roda uma vez quando o servidor do hub sobe (convenção do Next.js: instrumentation.ts na raiz do app).
// - Liga o relógio da fila do YouTube: os envios agendados saem na hora mesmo que ninguém esteja com o hub aberto, e
//   um envio que o reinício interrompeu continua de onde parou.
// - Liga a faxina dos vídeos (regra do dono: vídeo só fica guardado no Google Drive): leva ao Drive o que ficou no
//   disco, descarta o que passou do prazo e apaga as sobras (features/drive/servicos/faxina.ts).
// Uma falha aqui nunca impede o servidor de subir.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
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
}
