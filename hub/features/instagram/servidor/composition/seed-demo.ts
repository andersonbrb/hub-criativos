import { Channel } from '@sbs/markets';
import type { Container } from './container';

/**
 * Configuração inicial: mercados ES e FR com suas contas, e a conta de referência BR.
 * Só roda com o banco vazio. Os links de oferta são provisórios — ajuste em Mercados.
 * `runPipeline` também importa posts e gera adaptações de exemplo (demonstração).
 */
export async function seedDemoData(
  c: Container,
  options: { runPipeline: boolean },
): Promise<boolean> {
  if ((await c.markets.repo.list()).length > 0) return false;

  const es = await c.markets.createMarket.execute({
    code: 'es-latam',
    name: 'América Latina',
    locale: 'es-419',
    timezone: 'America/Mexico_City',
    productName: 'San Benito',
    offerUrl: 'https://sanbenito.example.com/es',
    glossary: [
      { source: 'São Bento', target: 'San Benito' },
      { source: 'Nossa Senhora', target: 'Nuestra Señora' },
    ],
    forbiddenTerms: ['Sagrado Verso', 'sagradoverso.store', 'lojasagradoverso'],
  });
  await c.markets.createChannel.execute({
    marketId: es.id,
    handle: 'momentodeoracionsb',
    displayName: 'Momento de Oración | San Benito',
  });

  const fr = await c.markets.createMarket.execute({
    code: 'fr',
    name: 'França',
    locale: 'fr-FR',
    timezone: 'Europe/Paris',
    productName: 'Saint Benoît',
    offerUrl: 'https://sanbenito.example.com/fr',
    glossary: [
      { source: 'São Bento', target: 'saint Benoît' },
      { source: 'Nossa Senhora', target: 'Notre-Dame' },
    ],
    forbiddenTerms: ['Sagrado Verso', 'sagradoverso.store', 'lojasagradoverso'],
  });
  await c.markets.createChannel.execute({
    marketId: fr.id,
    handle: 'momentdepriere.fr',
    displayName: 'Moment de Prière | Saint Benoît',
  });

  const source = await c.reference.registerSource.execute({ handle: 'santaespiritualidade' });

  if (options.runPipeline) {
    // Popula o painel: importa posts, seleciona os melhores e deixa as adaptações prontas para revisão.
    await c.reference.sync.execute({ sourceId: source.id });
    await c.reference.selectTop.execute();
    await c.jobs.drain();
  }
  return true;
}

/** @ provisórios cadastrados errado na configuração inicial → @ corretos. */
const HANDLE_CORRECTIONS: Record<string, string> = { 'momentdepriere.sb': 'momentdepriere.fr' };

/**
 * Corrige dados da configuração inicial em bancos já criados. Idempotente; só mexe em canal
 * que nunca foi conectado (depois disso, o @ vem do próprio Instagram no login).
 */
export async function correctInitialData(c: Container): Promise<number> {
  let fixed = 0;
  for (const [wrong, right] of Object.entries(HANDLE_CORRECTIONS)) {
    const channel = await c.markets.channels.findByHandle(wrong);
    if (!channel || channel.externalAccountId !== null) continue;
    if (await c.markets.channels.findByHandle(right)) continue;
    const corrected = Channel.fromSnapshot({ ...channel.toSnapshot(), handle: right });
    await c.markets.channels.save(corrected);
    fixed += 1;
  }
  return fixed;
}
