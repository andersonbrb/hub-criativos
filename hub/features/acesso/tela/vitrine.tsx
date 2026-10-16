// Lado direito das telas de entrada, como no ElevenLabs: um painel arredondado com esferas azuis derivando devagar e a
// frase do hub. Some no celular (fica só o formulário).
export function ArteDoHub() {
  return (
    <aside className="hub-auth-art">
      <i aria-hidden="true" />
      <i aria-hidden="true" />
      <i aria-hidden="true" />
      <div className="hub-auth-caption">
        <p className="text-[0.8125rem] text-white/70">Hub de Criativos · Grupo Chegou</p>
        <p className="mt-1 text-xl font-semibold tracking-[-0.02em]">Do briefing ao vídeo pronto.</p>
        <p className="mt-2 max-w-[46ch] text-sm leading-relaxed text-white/75">
          Agentes de IA, estúdios de voz, avatar e imagem, edição de vídeo e o quadro da produção, num lugar só.
        </p>
      </div>
    </aside>
  );
}
