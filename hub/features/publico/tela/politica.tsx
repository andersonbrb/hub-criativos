import { EMAIL_DE_CONTATO, POLITICA_ATUALIZADA_EM, RESPONSAVEL } from "@/features/publico/contrato";

// Texto da Política de Privacidade (app/privacidade). Descreve o que o hub faz de fato com a conta Google
// (features/drive e features/youtube): ao mudar o que o hub lê, guarda ou envia, mude aqui também e a data em
// contrato.ts. Os itens sobre o YouTube seguem o que as políticas dos Serviços de API do YouTube pedem (avisar que o
// hub usa esses serviços, ligar aos Termos do YouTube e à Política de Privacidade do Google, explicar como revogar).

const POLITICA_DO_GOOGLE = "https://developers.google.com/terms/api-services-user-data-policy";
const USO_LIMITADO = "https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes";
// Página de permissões da conta Google (o endereço que as políticas do YouTube citam; abre a mesma página de
// myaccount.google.com/permissions).
const PERMISSOES_DA_CONTA = "https://security.google.com/settings/security/permissions";
const TERMOS_DO_YOUTUBE = "https://www.youtube.com/t/terms";
const PRIVACIDADE_DO_GOOGLE = "https://policies.google.com/privacy";

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 grid gap-3">
      <h2 className="font-heading text-lg font-semibold tracking-[-0.01em]">{titulo}</h2>
      {children}
    </section>
  );
}

function Lista({ children }: { children: React.ReactNode }) {
  return <ul className="grid list-disc gap-2 pl-5 marker:text-muted-foreground">{children}</ul>;
}

function Externo({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline">
      {children}
    </a>
  );
}

function EmailDeContato() {
  return (
    <a href={`mailto:${EMAIL_DE_CONTATO}`} className="text-primary underline-offset-4 hover:underline">
      {EMAIL_DE_CONTATO}
    </a>
  );
}

function Contato() {
  if (!EMAIL_DE_CONTATO) return <p>Responsável pelo Hub de Criativos: {RESPONSAVEL}.</p>;
  return (
    <p>
      Responsável pelo Hub de Criativos: {RESPONSAVEL}. Dúvidas, reclamações e pedidos sobre os seus dados (ver,
      corrigir ou apagar): <EmailDeContato />.
    </p>
  );
}

export function Politica() {
  return (
    <article className="text-[0.9375rem] leading-relaxed text-foreground/90 [&_strong]:font-semibold [&_strong]:text-foreground">
      <h1 className="font-heading text-[1.75rem] leading-tight text-foreground sm:text-[2rem]">Política de Privacidade</h1>
      <p className="mt-2 text-sm text-muted-foreground">Hub de Criativos · Atualizada em {POLITICA_ATUALIZADA_EM}</p>

      <div className="mt-8 grid gap-3">
        <p>
          O Hub de Criativos é um aplicativo web do {RESPONSAVEL} para produzir criativos de anúncio: roteiros com
          agentes de IA, voz, avatar, imagem e edição de vídeo. O acesso é só por convite. Cada pessoa entra com a conta
          criada a partir do convite de uma organização (uma empresa que usa o hub, com a própria equipe e os próprios
          dados).
        </p>
        <p>
          Esta política explica quais dados o hub usa e, em especial, o que ele faz com a conta Google quando uma
          organização conecta o Google Drive para guardar os vídeos ou um canal do YouTube para publicar os vídeos
          prontos.
        </p>
      </div>

      <Secao titulo="1. Quais dados do Google e do YouTube o hub acessa">
        <p>
          Quem tem a permissão de Integrações numa organização pode conectar uma conta Google ao hub. Nessa conexão o
          hub pede só estas permissões:
        </p>
        <Lista>
          <li>
            <strong>Ver, criar, editar e apagar apenas os arquivos do Google Drive que você usa com o hub</strong>{" "}
            (permissão <code>drive.file</code>). O hub não vê nem mexe no resto do seu Drive.
          </li>
          <li>
            <strong>Seu nome e seu endereço de e-mail do Google</strong> (permissões <code>openid</code>,{" "}
            <code>email</code> e <code>profile</code>), para mostrar qual conta está conectada.
          </li>
        </Lista>
        <p>Com essas permissões, o hub lê:</p>
        <Lista>
          <li>o nome e o e-mail da conta Google conectada;</li>
          <li>
            os vídeos que ele mesmo guardou no Drive e as informações desses arquivos: nome, tipo, tamanho, data da
            última alteração e se estão na lixeira;
          </li>
          <li>
            a pasta que você escolher na janela do próprio Google para guardar os vídeos: o hub lê só o identificador e
            o nome dela (e se fica num Drive compartilhado), cria a pasta &ldquo;Hub de Criativos&rdquo; lá dentro e não
            abre os outros arquivos que estão nela;
          </li>
          <li>o espaço usado e o limite do Drive da conta, para mostrar na tela de Integrações.</li>
        </Lista>
        <p>
          Quem tem a permissão de Integrações também pode conectar um canal do YouTube, escolhido na tela do próprio
          Google. Nessa conexão o hub pede só estas permissões:
        </p>
        <Lista>
          <li>
            <strong>Enviar vídeos ao seu canal do YouTube</strong> (permissão <code>youtube.upload</code>), usada só para
            subir os vídeos e as miniaturas que alguém da equipe manda enviar.
          </li>
          <li>
            <strong>Ver a sua conta do YouTube</strong> (permissão <code>youtube.readonly</code>), usada só para ler o
            identificador, o nome, o @ e a foto do canal conectado, e a situação dos vídeos que o próprio hub enviou (se
            o YouTube aceitou, recusou ou deixou o vídeo privado).
          </li>
        </Lista>
        <p>O hub não lê, não edita e não apaga os outros vídeos do canal.</p>
      </Secao>

      <Secao titulo="2. Para que o hub usa esses dados">
        <Lista>
          <li>
            Guardar no seu Drive, numa pasta &ldquo;Hub de Criativos&rdquo; com uma subpasta por tipo, os vídeos que o
            hub gera para a sua equipe (edições, traduções, avatares e outros).
          </li>
          <li>Mostrar, tocar e baixar esses vídeos dentro do hub, e usá-los nas próximas edições.</li>
          <li>
            Manter o hub igual ao Drive: o que alguém apagar, renomear ou mandar para a lixeira direto no Drive aparece
            assim no hub. Renomear um vídeo no hub renomeia o arquivo no Drive, e apagar no hub manda o arquivo para a
            lixeira do Drive.
          </li>
          <li>Mostrar qual conta está conectada e quanto espaço ela já usa.</li>
          <li>
            Enviar ao canal do YouTube conectado os vídeos prontos que alguém da equipe escolher, com o título, a
            descrição, a visibilidade (público, não listado ou privado), a miniatura e o dia e horário que essa pessoa
            definir. Nada vai para o YouTube sem esse pedido.
          </li>
          <li>
            Mostrar o andamento e o resultado de cada envio, com o link do vídeo, e avisar quando o YouTube recusa um
            vídeo ou o deixa com outra visibilidade.
          </li>
        </Lista>
        <p>
          O hub não usa dados do Google para publicidade, não monta perfil de ninguém e não usa esses dados para treinar
          modelos de inteligência artificial.
        </p>
      </Secao>

      <Secao titulo="3. Com quem os dados são compartilhados">
        <p>
          O hub <strong>não vende, não aluga e não repassa</strong> dados do Google a ninguém. Um vídeo, ou parte dele,
          só sai do hub nestes casos:
        </p>
        <Lista>
          <li>
            <strong>Quando a equipe pede um trabalho sobre o vídeo.</strong> Se alguém pede ao hub, pela tela ou pelo
            chat com os agentes, para traduzir, transcrever ou analisar um vídeo, o hub envia o vídeo, ou só a parte
            necessária, ao serviço que faz esse trabalho: HeyGen (tradução do vídeo), ElevenLabs (transcrição, só o
            áudio) e o modelo de IA do chat (alguns quadros e a fala do vídeo, para o agente &ldquo;assistir&rdquo;).
            O modelo do chat é o Claude, da Anthropic, inclusive quando a pessoa usa o hub pelo próprio Claude; no Modo
            Black, é o da Venice AI. Cada serviço recebe só o que precisa para entregar o resultado pedido.
          </li>
          <li>
            <strong>Com o YouTube, quando a equipe manda enviar um vídeo.</strong> O vídeo, o título, a descrição e a
            miniatura escolhidos vão para o canal conectado e, a partir daí, seguem a visibilidade escolhida e as regras
            do YouTube.
          </li>
          <li>
            <strong>Na própria equipe.</strong> As pessoas da mesma organização no hub veem os vídeos dessa
            organização. Pessoas de outras organizações não veem.
          </li>
          <li>
            <strong>Na hospedagem.</strong> O hub roda num servidor contratado na Railway, que guarda os dados do hub em
            nome do {RESPONSAVEL}.
          </li>
          <li>
            <strong>Por obrigação legal.</strong> Se uma lei ou ordem judicial exigir.
          </li>
        </Lista>
      </Secao>

      <Secao titulo="4. Como o hub guarda e protege os dados">
        <Lista>
          <li>
            A autorização que o Google entrega ao hub (os tokens de acesso) fica no banco de dados do hub{" "}
            <strong>cifrada</strong> (AES-256), com uma chave que existe só no servidor. Ela nunca fica em texto aberto.
          </li>
          <li>
            O nome e o e-mail da conta Google e a pasta escolhida ficam no banco do hub enquanto a conta estiver
            conectada.
          </li>
          <li>Para cada vídeo, o hub guarda o identificador e o nome do arquivo no Drive, para achá-lo de novo.</li>
          <li>
            Os vídeos ficam no seu Google Drive. O servidor do hub só guarda cópias temporárias enquanto trabalha num
            vídeo, e a limpeza automática apaga essas cópias depois de algumas horas sem uso.
          </li>
          <li>O espaço usado do Drive não é gravado: o hub consulta na hora e guarda por um minuto na memória.</li>
          <li>
            Do YouTube, o hub guarda a autorização do canal (cifrada, como a do Drive) e o identificador, o nome, o @ e o
            endereço da foto do canal conectado.
          </li>
          <li>
            Para cada envio ao YouTube, o hub guarda o que a equipe preencheu (título, descrição, visibilidade, dia e
            horário), o identificador do vídeo no YouTube, a situação do envio e o motivo de uma falha. A imagem da
            miniatura fica no servidor até ser aplicada ao vídeo; se o envio for cancelado, ela é apagada na hora.
            Enquanto um vídeo sobe, o endereço desse envio fica guardado cifrado, para continuar de onde parou se o
            servidor reiniciar.
          </li>
          <li>Toda comunicação com o hub e com o Google é cifrada (HTTPS).</li>
          <li>
            Só pessoas convidadas entram no hub, com e-mail e senha. Só quem tem a permissão de Integrações na
            organização conecta ou desconecta o Drive e o YouTube, e só quem tem a permissão de enviar ao YouTube manda
            vídeos para o canal.
          </li>
        </Lista>
      </Secao>

      <Secao titulo="5. Por quanto tempo">
        <p>
          Os dados da conta Google ficam no hub enquanto ela estiver conectada. Ao desconectar, o hub apaga na hora a
          autorização guardada, o nome e o e-mail da conta e a pasta escolhida, e pede ao Google para cancelar o acesso
          dele. Os vídeos continuam no seu Drive, porque são seus. O hub mantém só o registro deles (nome e
          identificador), para voltar a mostrá-los se a mesma conta for conectada de novo.
        </p>
        <p>
          Ao desconectar o YouTube, o hub apaga na hora a autorização guardada e os dados do canal, pede ao Google para
          cancelar o acesso dele e cancela os envios que estavam agendados. Os vídeos já enviados continuam no seu
          canal. O hub mantém o histórico dos envios da organização (título, descrição, situação e link do vídeo).
        </p>
      </Secao>

      <Secao titulo="6. Como tirar o acesso do hub">
        <Lista>
          <li>
            <strong>No hub:</strong> tela Integrações, cartão Google Drive ou cartão YouTube, botão Desconectar.
          </li>
          <li>
            <strong>Na sua conta Google, a qualquer momento:</strong> abra a página de segurança da conta,{" "}
            <Externo href={PERMISSOES_DA_CONTA}>security.google.com/settings/security/permissions</Externo>, escolha Hub
            de Criativos e remova o acesso. Na próxima vez que o hub tentar usar o Drive ou o YouTube, o Google recusa e
            o hub apaga sozinho a autorização guardada.
          </li>
        </Lista>
      </Secao>

      <Secao titulo="7. Como pedir a exclusão dos dados">
        <Lista>
          <li>
            Os vídeos ficam no seu Drive e você pode apagá-los lá quando quiser. Apagar um vídeo no hub também manda o
            arquivo para a lixeira do seu Drive.
          </li>
          <li>
            Os vídeos enviados ao YouTube ficam no seu canal. Para tirá-los do ar ou apagá-los, use o YouTube Studio: o
            hub não tem permissão para apagar vídeos do canal.
          </li>
          <li>Para apagar o que o hub guarda sobre a sua conta Google ou o seu canal, desconecte (veja o item 6).</li>
          <li>
            Para pedir a exclusão de todos os seus dados no hub, ou para ver ou corrigir esses dados,{" "}
            {EMAIL_DE_CONTATO ? (
              <>
                escreva para <EmailDeContato />.
              </>
            ) : (
              "fale com o responsável pelo hub (veja o item 11)."
            )}
          </li>
        </Lista>
      </Secao>

      <Secao titulo="8. Uso limitado dos dados do Google">
        <p>
          O uso e a transferência, pelo Hub de Criativos, de informações recebidas das APIs do Google para qualquer
          outro app seguem a{" "}
          <Externo href={POLITICA_DO_GOOGLE}>Política de Dados do Usuário dos Serviços de API do Google</Externo>{" "}
          (Google API Services User Data Policy), incluindo os{" "}
          <Externo href={USO_LIMITADO}>requisitos de Uso Limitado</Externo> (Limited Use requirements).
        </p>
        <p>Na prática:</p>
        <Lista>
          <li>o hub usa os dados do Google só para as funções descritas acima, que a equipe vê e usa;</li>
          <li>só transfere esses dados nos casos do item 3, para entregar o que a equipe pediu, ou se a lei exigir;</li>
          <li>não usa esses dados para publicidade nem para treinar modelos de inteligência artificial;</li>
          <li>
            fora do uso normal do hub pela sua equipe, ninguém lê esses dados, a não ser com a sua autorização, para
            investigar um problema de segurança ou para cumprir a lei.
          </li>
        </Lista>
      </Secao>

      <Secao titulo="9. YouTube">
        <p>
          O Hub de Criativos usa os Serviços de API do YouTube (YouTube API Services). Ao conectar um canal e enviar
          vídeos pelo hub, você concorda com os{" "}
          <Externo href={TERMOS_DO_YOUTUBE}>Termos de Serviço do YouTube</Externo>. A{" "}
          <Externo href={PRIVACIDADE_DO_GOOGLE}>Política de Privacidade do Google</Externo> vale para o que o Google e o
          YouTube fazem com esses dados.
        </p>
      </Secao>

      <Secao titulo="10. Outros dados que o hub guarda">
        <p>
          Para funcionar, o hub guarda também a conta de cada pessoa (nome, e-mail e a senha, embaralhada, nunca em
          texto) e o que a equipe produz nele: conversas com os agentes, quadro da produção, imagens, áudios e os
          registros dos vídeos. O hub usa cookies só para manter a pessoa conectada e lembrar preferências da tela (como
          o menu aberto ou fechado). Não há cookies de publicidade nem de rastreamento.
        </p>
      </Secao>

      <Secao titulo="11. Contato">
        <Contato />
        <p>Mudanças nesta política são publicadas nesta página, com a data de atualização no topo.</p>
      </Secao>
    </article>
  );
}
